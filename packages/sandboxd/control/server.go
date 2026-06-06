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
	"time"
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
}

type serverState struct {
	mutex     sync.Mutex
	phase     ActivationPhase
	initError *string
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
		return OKResponse(nil), true
	case RequestActivate:
		return ErrorResponse("sandbox startup request was rejected: daemon activation is not migrated to Go"), false
	case RequestSign:
		return ErrorResponse("sandbox startup request was rejected: daemon signing is not migrated to Go"), false
	default:
		return ErrorResponse(fmt.Sprintf("unsupported control request type: %s", request.Type)), false
	}
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

type healthResponse struct {
	DaemonPhase string  `json:"daemon_phase"`
	ObservedAt  string  `json:"observed_at"`
	Snapshot    *string `json:"snapshot"`
	InitError   *string `json:"init_error"`
}

func (server *Server) healthResponse() healthResponse {
	server.state.mutex.Lock()
	defer server.state.mutex.Unlock()
	return healthResponse{
		DaemonPhase: string(server.state.phase),
		ObservedAt:  time.Now().UTC().Format(time.RFC3339Nano),
		Snapshot:    nil,
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
