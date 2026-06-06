package control

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/sandboxdstate"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
	"github.com/mistle/sandboxd/tunnel"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const (
	DefaultHealthEndpointAddr = "127.0.0.1:3901"
	DefaultHealthEndpointPath = "/__healthz"
)

type ActivationPhase string

const (
	ActivationPhaseUnactivated ActivationPhase = "unactivated"
	ActivationPhaseActivating  ActivationPhase = "activating"
	ActivationPhaseActivated   ActivationPhase = "activated"
	ActivationPhaseFailed      ActivationPhase = "failed"
)

type Server struct {
	listener       net.Listener
	healthListener net.Listener
	healthServer   *http.Server
	socketPath     string
	done           chan error
	healthDone     chan error
	closeOnce      sync.Once
	state          *serverState
	signRequestID  atomic.Uint64
}

type serverState struct {
	mutex           sync.Mutex
	phase           ActivationPhase
	activationInput *protocol.ActivationInput
	sandboxdState   *sandboxdstate.State
	initError       *string
}

func StartServer(socketPath string) (*Server, error) {
	return StartServerWithHealthEndpoint(socketPath, DefaultHealthEndpointAddr)
}

func StartServerWithHealthEndpoint(socketPath string, healthEndpointAddr string) (*Server, error) {
	if socketPath == "" {
		return nil, fmt.Errorf("control socket path is required")
	}
	parent := filepath.Dir(socketPath)
	if parent == "." || parent == "" {
		return nil, fmt.Errorf("control socket path %s has no parent directory", socketPath)
	}
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create control socket directory %s: %w", parent, err)
	}
	if err := removeStaleSocket(socketPath); err != nil {
		return nil, err
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("failed to bind control socket %s: %w", socketPath, err)
	}
	healthListener, err := net.Listen("tcp", healthEndpointAddr)
	if err != nil {
		listener.Close()
		return nil, fmt.Errorf("failed to bind health endpoint %s: %w", healthEndpointAddr, err)
	}
	state := &serverState{phase: ActivationPhaseUnactivated}
	server := &Server{
		listener:       listener,
		healthListener: healthListener,
		socketPath:     socketPath,
		done:           make(chan error, 1),
		healthDone:     make(chan error, 1),
		state:          state,
	}
	server.healthServer = &http.Server{Handler: server.healthHandler()}
	go server.run()
	go server.runHealth()
	return server, nil
}

func (server *Server) HealthEndpointAddr() string {
	if server == nil || server.healthListener == nil {
		return ""
	}
	return server.healthListener.Addr().String()
}

func (server *Server) Wait() error {
	if server == nil {
		return fmt.Errorf("control server is required")
	}
	controlErr := <-server.done
	_ = server.healthServer.Close()
	healthErr := <-server.healthDone
	if controlErr != nil {
		return controlErr
	}
	return healthErr
}

func (server *Server) Close() error {
	if server == nil {
		return nil
	}
	server.closeOnce.Do(func() {
		_ = server.listener.Close()
		_ = server.healthServer.Close()
	})
	return server.Wait()
}

func (server *Server) run() {
	for {
		connection, err := server.listener.Accept()
		if err != nil {
			if isClosedNetworkError(err) {
				server.finish(nil)
				return
			}
			server.finish(fmt.Errorf("failed to accept control socket connection: %w", err))
			return
		}
		shouldStop, err := server.handleServerConnection(connection)
		if err != nil {
			server.finish(err)
			return
		}
		if shouldStop {
			server.finish(nil)
			return
		}
	}
}

func (server *Server) finish(err error) {
	_ = os.Remove(server.socketPath)
	server.done <- err
}

func (server *Server) runHealth() {
	err := server.healthServer.Serve(server.healthListener)
	if err == http.ErrServerClosed {
		err = nil
	}
	server.healthDone <- err
}

func (server *Server) handleServerConnection(connection net.Conn) (bool, error) {
	defer connection.Close()
	requestBytes, err := io.ReadAll(connection)
	if err != nil {
		return false, writeServerResponse(connection, ErrorResponse(fmt.Sprintf("failed to read control socket request: %v", err)))
	}
	request, err := DecodeRequest(requestBytes)
	if err != nil {
		return false, writeServerResponse(connection, ErrorResponse(err.Error()))
	}
	response, shouldStop := server.dispatchServerRequest(request)
	return shouldStop, writeServerResponse(connection, response)
}

func (server *Server) dispatchServerRequest(request Request) (Response, bool) {
	switch request.Type {
	case RequestReady:
		return OKResponse(nil), false
	case RequestShutdown:
		if err := server.beginShutdown(); err != nil {
			return ErrorResponse(err.Error()), false
		}
		return OKResponse(nil), true
	case RequestActivate:
		if err := server.beginActivate(*request.ActivationInput); err != nil {
			return ErrorResponse(err.Error()), false
		}
		return OKResponse(nil), false
	case RequestSign:
		signatureBase64, err := server.requestSigning(*request.SignRequest)
		if err != nil {
			return ErrorResponse(err.Error()), false
		}
		return OKResponse(&signatureBase64), false
	default:
		return ErrorResponse(fmt.Sprintf("unsupported control request type: %s", request.Type)), false
	}
}

func (server *Server) beginShutdown() error {
	server.state.mutex.Lock()
	defer server.state.mutex.Unlock()
	if server.state.sandboxdState != nil {
		if err := server.state.sandboxdState.Close(); err != nil {
			return fmt.Errorf("failed to close sandboxd state: %w", err)
		}
	}
	server.state.phase = ActivationPhaseUnactivated
	server.state.activationInput = nil
	server.state.sandboxdState = nil
	server.state.initError = nil
	return nil
}

func (server *Server) beginActivate(activationInput protocol.ActivationInput) error {
	if err := validateActivationInputForStateInitialization(activationInput); err != nil {
		return err
	}
	server.state.mutex.Lock()
	defer server.state.mutex.Unlock()
	switch server.state.phase {
	case ActivationPhaseUnactivated:
		server.state.phase = ActivationPhaseActivating
		server.state.activationInput = cloneActivationInput(activationInput)
		sandboxdState, err := sandboxdstate.ActivateNew(activationInput, timeutil.SystemClock{})
		if err == nil {
			server.state.sandboxdState = sandboxdState
			server.state.phase = ActivationPhaseActivated
			server.state.initError = nil
			return nil
		}
		errorText := fmt.Sprintf("failed to initialize sandboxd state: %s", err.Error())
		server.state.phase = ActivationPhaseFailed
		server.state.initError = &errorText
		return fmt.Errorf("sandbox startup request was rejected: sandboxd activation failed: %s", errorText)
	case ActivationPhaseActivating:
		return fmt.Errorf("sandbox startup request was rejected: sandboxd is still initializing after activation wait")
	case ActivationPhaseActivated:
		if activationInputsEqual(server.state.activationInput, &activationInput) {
			return nil
		}
		if server.state.activationInput == nil {
			return fmt.Errorf("sandbox startup request was rejected: sandboxd is activated without accepted session input")
		}
		if string(server.state.activationInput.RuntimePlan) != string(activationInput.RuntimePlan) {
			return fmt.Errorf("failed to resume sandboxd state: initialized activation cannot change runtime plan")
		}
		if server.state.sandboxdState == nil {
			return fmt.Errorf("failed to resume sandboxd state: activated daemon is missing sandboxd state")
		}
		if err := server.state.sandboxdState.ActivateInitialized(activationInput); err != nil {
			return fmt.Errorf("failed to resume sandboxd state: %w", err)
		}
		server.state.activationInput = cloneActivationInput(activationInput)
		return nil
	case ActivationPhaseFailed:
		if server.state.initError == nil {
			return fmt.Errorf("sandbox startup request was rejected: sandboxd activation already failed")
		}
		return fmt.Errorf("sandbox startup request was rejected: sandboxd activation already failed: %s", *server.state.initError)
	default:
		return fmt.Errorf("sandbox startup request was rejected: unsupported daemon activation phase %s", server.state.phase)
	}
}

func validateActivationInputForStateInitialization(activationInput protocol.ActivationInput) error {
	if _, err := tunnel.DeriveSandboxInstanceID(activationInput.TunnelGatewayWSURL); err != nil {
		return fmt.Errorf("failed to initialize sandboxd state: failed to start bootstrap tunnel session: %w", err)
	}
	if _, err := sandboxdstate.DecodeRuntimePlan(activationInput.RuntimePlan); err != nil {
		return fmt.Errorf("failed to initialize sandboxd state: failed to apply session input: %w", err)
	}
	return nil
}

func (server *Server) buildSigningTunnelRequestPayload(signRequest SignRequest) (string, error) {
	payload, _, err := server.buildSigningTunnelRequestPayloadAndState(signRequest)
	return payload, err
}

func (server *Server) requestSigning(signRequest SignRequest) (string, error) {
	payload, sandboxdState, err := server.buildSigningTunnelRequestPayloadAndState(signRequest)
	if err != nil {
		return "", err
	}
	return sandboxdState.RequestSigning(payload)
}

func (server *Server) buildSigningTunnelRequestPayloadAndState(signRequest SignRequest) (string, *sandboxdstate.State, error) {
	server.state.mutex.Lock()
	defer server.state.mutex.Unlock()
	if server.state.activationInput == nil {
		return "", nil, fmt.Errorf("sandbox startup request was rejected: sandboxd is not activated")
	}
	activationInput := server.state.activationInput
	gitIdentity := activationInput.GitIdentity
	if gitIdentity == nil || gitIdentity.Signing == nil {
		return "", nil, fmt.Errorf("sandbox startup request was rejected: sandbox does not have a configured Git signing identity")
	}
	signingConfig := gitIdentity.Signing
	if signingConfig.KeyRef != signRequest.KeyRef {
		return "", nil, fmt.Errorf("sandbox startup request was rejected: requested Git signing key does not match the configured Git signing identity")
	}
	if server.state.phase != ActivationPhaseActivated {
		return "", nil, fmt.Errorf("sandbox startup request was rejected: sandboxd state is missing for an activated daemon")
	}
	if server.state.sandboxdState == nil {
		return "", nil, fmt.Errorf("sandbox startup request was rejected: sandboxd state is missing for an activated daemon")
	}
	sandboxInstanceID, err := tunnel.DeriveSandboxInstanceID(activationInput.TunnelGatewayWSURL)
	if err != nil {
		return "", nil, fmt.Errorf("failed to initialize sandboxd state: failed to start bootstrap tunnel session: %w", err)
	}
	requestID := fmt.Sprintf("sign_req_%d", server.signRequestID.Add(1)-1)
	payload, err := tunnelprotocol.SigningRequestPayload(tunnelprotocol.SigningRequest{
		MessageType:             "signing.request",
		RequestID:               requestID,
		OrganizationID:          signingConfig.OrganizationID,
		SandboxInstanceID:       sandboxInstanceID,
		ActingUserID:            signingConfig.ActingUserID,
		ProviderFamily:          signingConfig.ProviderFamily,
		IntegrationConnectionID: signingConfig.IntegrationConnectionID,
		Format:                  signingConfig.Format,
		KeyRef:                  signingConfig.KeyRef,
		Grant:                   signingConfig.Grant,
		Payload:                 signRequest.PayloadBase64,
		Encoding:                "base64",
	})
	if err != nil {
		return "", nil, err
	}
	return payload, server.state.sandboxdState, nil
}

func (server *Server) healthHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(DefaultHealthEndpointPath, func(responseWriter http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			writeHealthJSON(responseWriter, http.StatusNotFound, map[string]string{"error": "not_found"})
			return
		}
		writeHealthJSON(responseWriter, http.StatusOK, server.healthResponse())
	})
	mux.HandleFunc("/", func(responseWriter http.ResponseWriter, request *http.Request) {
		writeHealthJSON(responseWriter, http.StatusNotFound, map[string]string{"error": "not_found"})
	})
	return mux
}

func cloneActivationInput(input protocol.ActivationInput) *protocol.ActivationInput {
	cloned := input
	cloned.RuntimePlan = append([]byte(nil), input.RuntimePlan...)
	return &cloned
}

func activationInputsEqual(left *protocol.ActivationInput, right *protocol.ActivationInput) bool {
	if left == nil || right == nil {
		return left == right
	}
	leftPlan := string(left.RuntimePlan)
	rightPlan := string(right.RuntimePlan)
	leftCopy := *left
	rightCopy := *right
	leftCopy.RuntimePlan = nil
	rightCopy.RuntimePlan = nil
	return leftPlan == rightPlan &&
		leftCopy.OperationKind == rightCopy.OperationKind &&
		leftCopy.BootstrapToken == rightCopy.BootstrapToken &&
		leftCopy.TunnelExchangeToken == rightCopy.TunnelExchangeToken &&
		leftCopy.TunnelGatewayWSURL == rightCopy.TunnelGatewayWSURL &&
		stringPointerEqual(leftCopy.ActingUserID, rightCopy.ActingUserID) &&
		gitIdentityEqual(leftCopy.GitIdentity, rightCopy.GitIdentity)
}

func stringPointerEqual(left *string, right *string) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}

func gitIdentityEqual(left *protocol.GitIdentity, right *protocol.GitIdentity) bool {
	if left == nil || right == nil {
		return left == right
	}
	if left.Name != right.Name || left.Email != right.Email {
		return false
	}
	return gitSigningConfigEqual(left.Signing, right.Signing)
}

func gitSigningConfigEqual(left *protocol.GitSigningConfig, right *protocol.GitSigningConfig) bool {
	if left == nil || right == nil {
		return left == right
	}
	return left.Format == right.Format &&
		left.Program == right.Program &&
		left.KeyRef == right.KeyRef &&
		left.OrganizationID == right.OrganizationID &&
		left.ProviderFamily == right.ProviderFamily &&
		stringPointerEqual(left.IntegrationConnectionID, right.IntegrationConnectionID) &&
		left.ActingUserID == right.ActingUserID &&
		left.Grant == right.Grant
}

type healthResponse struct {
	DaemonPhase string                      `json:"daemon_phase"`
	ObservedAt  string                      `json:"observed_at"`
	Snapshot    *supervision.HealthSnapshot `json:"snapshot"`
	InitError   *string                     `json:"init_error"`
}

func (server *Server) healthResponse() healthResponse {
	server.state.mutex.Lock()
	defer server.state.mutex.Unlock()
	var snapshot *supervision.HealthSnapshot
	if server.state.phase == ActivationPhaseActivated && server.state.sandboxdState != nil {
		healthSnapshot := server.state.sandboxdState.HealthSnapshot()
		snapshot = &healthSnapshot
	}
	return healthResponse{
		DaemonPhase: string(server.state.phase),
		ObservedAt:  time.Now().UTC().Format(time.RFC3339Nano),
		Snapshot:    snapshot,
		InitError:   server.state.initError,
	}
}

func writeHealthJSON(responseWriter http.ResponseWriter, statusCode int, payload any) {
	responseWriter.Header().Set("content-type", "application/json")
	responseWriter.WriteHeader(statusCode)
	_ = json.NewEncoder(responseWriter).Encode(payload)
}

func writeServerResponse(connection net.Conn, response Response) error {
	responseBytes, err := json.Marshal(response)
	if err != nil {
		return fmt.Errorf("failed to serialize control socket response: %w", err)
	}
	if _, err := connection.Write(responseBytes); err != nil {
		return fmt.Errorf("failed to write control socket response: %w", err)
	}
	return nil
}

func removeStaleSocket(socketPath string) error {
	metadata, err := os.Lstat(socketPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("failed to inspect control socket path %s: %w", socketPath, err)
	}
	if metadata.Mode()&os.ModeSocket == 0 {
		return fmt.Errorf("control socket path %s already exists and is not a unix socket", socketPath)
	}
	if err := os.Remove(socketPath); err != nil {
		return fmt.Errorf("failed to remove stale control socket %s: %w", socketPath, err)
	}
	return nil
}

func isClosedNetworkError(err error) bool {
	if err == nil {
		return false
	}
	return err == net.ErrClosed
}
