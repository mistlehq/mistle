package tunnel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/keepalive"
	mistleprotocol "github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime/readiness"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const DefaultProcessesSnapshotInterval = 500 * time.Millisecond
const DefaultLiveTunnelPublishInterval = 100 * time.Millisecond
const GatewayServiceRestartCloseCode websocket.StatusCode = 4001
const GatewayServiceRestartCloseReason = "service_restart"
const defaultFileSearchDebounce = 100 * time.Millisecond

var DefaultTunnelReconnectBackoff = []time.Duration{
	100 * time.Millisecond,
	250 * time.Millisecond,
	500 * time.Millisecond,
	time.Second,
	2 * time.Second,
}

type LiveTunnelSessionOptions struct {
	AgentEndpointURL         string
	AttachmentRoot           string
	CgroupRoot               string
	OperationID              string
	OperationKind            string
	RuntimeEnv               map[string]string
	GatewayWSURL             string
	TunnelExchangeToken      string
	TunnelExchangeHTTPClient *http.Client
	Clock                    timeutil.Clock
	KeepaliveManager         *keepalive.SharedManager
	RuntimeReadinessManager  *readiness.Manager
	SupervisorHandle         *supervision.SandboxdSupervisorHandle
}

type LiveTunnelSession struct {
	tunnel                   *BootstrapTunnel
	connection               *websocket.Conn
	sandboxInstanceID        string
	agentEndpoint            string
	attachmentRoot           string
	cgroupRoot               string
	operationID              string
	operationKind            string
	runtimeEnv               map[string]string
	gatewayWSURL             string
	tunnelExchangeToken      string
	tunnelExchangeHTTPClient *http.Client
	clock                    timeutil.Clock
	keepaliveManager         *keepalive.SharedManager
	runtimeReadinessManager  *readiness.Manager
	supervisorHandle         *supervision.SandboxdSupervisorHandle
	writeMutex               sync.Mutex
	mutex                    sync.Mutex
	streams                  map[uint32]*liveTunnelStream
	pendingAgentOpens        map[uint32]context.CancelFunc
	signing                  map[string]chan liveSigningResponse
	egressTokens             map[string]chan liveEgressTokenResponse
	nextEgressTokenRequestID atomic.Uint64
	operation                operationStreamState
	telemetry                telemetryRelayState
	cancel                   context.CancelFunc
	done                     chan struct{}
	once                     sync.Once
}

type liveSigningResponse struct {
	payload string
	err     error
}

type liveEgressTokenResponse struct {
	token     string
	expiresAt string
	ttlMS     uint64
	err       error
}

type liveTunnelStream struct {
	kind              string
	channel           tunnelprotocol.StreamChannel
	agent             *websocket.Conn
	cancel            context.CancelFunc
	upload            *fileUploadState
	fileSearch        chan fileSearchCommand
	httpBodyWriter    *io.PipeWriter
	tcpConnection     net.Conn
	tcpRequestWindow  uint64
	tcpRequestClosed  bool
	tcpResponseClosed bool
	window            uint64
	lastSent          time.Time
	agentStats        *agentStreamStats
}

type fileSearchCommand struct {
	query *tunnelprotocol.FileSearchQuery
}

type outstandingAgentSend struct {
	bytes    uint64
	sentAtMS uint64
}

type agentStreamThresholdTelemetry struct {
	streamID         uint32
	payloadKind      byte
	payloadBytes     int
	availableBytes   uint64
	outstandingBytes uint64
	thresholdBytes   uint64
	messageCountOut  uint64
	streamAgeMS      uint64
	oldestUnackedMS  any
}

type agentStreamStats struct {
	openedAtMS          uint64
	messageCountOut     uint64
	messageCountIn      uint64
	totalBytesOut       uint64
	totalBytesIn        uint64
	maxMessageBytesOut  uint64
	maxMessageBytesIn   uint64
	maxOutstandingBytes uint64
	creditReturnCount   uint64
	creditReturnTotalMS uint64
	thresholdMask       uint8
	outstandingSends    []outstandingAgentSend
}

func StartLiveTunnelSession(tunnel *BootstrapTunnel, options LiveTunnelSessionOptions) (*LiveTunnelSession, error) {
	if tunnel == nil || tunnel.connection == nil {
		return nil, fmt.Errorf("bootstrap tunnel connection is required")
	}
	if options.Clock == nil {
		return nil, fmt.Errorf("live tunnel session clock is required")
	}
	if options.KeepaliveManager == nil {
		return nil, fmt.Errorf("live tunnel keepalive manager is required")
	}
	if options.RuntimeReadinessManager == nil {
		return nil, fmt.Errorf("live tunnel runtime readiness manager is required")
	}
	sandboxInstanceID, err := DeriveSandboxInstanceID(tunnel.ConnectedURL())
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	attachmentRoot := options.AttachmentRoot
	if attachmentRoot == "" {
		attachmentRoot = DefaultAttachmentRoot
	}
	session := &LiveTunnelSession{
		tunnel:                   tunnel,
		connection:               tunnel.connection,
		sandboxInstanceID:        sandboxInstanceID,
		agentEndpoint:            options.AgentEndpointURL,
		attachmentRoot:           attachmentRoot,
		cgroupRoot:               options.CgroupRoot,
		operationID:              options.OperationID,
		operationKind:            options.OperationKind,
		runtimeEnv:               cloneStringMap(options.RuntimeEnv),
		gatewayWSURL:             options.GatewayWSURL,
		tunnelExchangeToken:      options.TunnelExchangeToken,
		tunnelExchangeHTTPClient: options.TunnelExchangeHTTPClient,
		clock:                    options.Clock,
		keepaliveManager:         options.KeepaliveManager,
		runtimeReadinessManager:  options.RuntimeReadinessManager,
		supervisorHandle:         options.SupervisorHandle,
		streams:                  map[uint32]*liveTunnelStream{},
		pendingAgentOpens:        map[uint32]context.CancelFunc{},
		signing:                  map[string]chan liveSigningResponse{},
		egressTokens:             map[string]chan liveEgressTokenResponse{},
		cancel:                   cancel,
		done:                     make(chan struct{}),
	}
	session.markConnected()
	if err := session.publishInitialRuntimeReadiness(ctx); err != nil {
		session.markDisconnected()
		cancel()
		return nil, err
	}
	if err := session.openTelemetryStream(ctx); err != nil {
		session.markDisconnected()
		cancel()
		return nil, err
	}
	if err := session.openOperationStream(ctx); err != nil {
		session.markDisconnected()
		cancel()
		return nil, err
	}
	if session.gatewayWSURL != "" && session.tunnelExchangeHTTPClient == nil {
		session.tunnelExchangeHTTPClient = http.DefaultClient
	}
	go session.run(ctx)
	return session, nil
}

func (session *LiveTunnelSession) SetAgentEndpointURL(agentEndpointURL string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	session.agentEndpoint = agentEndpointURL
}

func (session *LiveTunnelSession) SetRuntimeEnv(runtimeEnv map[string]string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	session.runtimeEnv = cloneStringMap(runtimeEnv)
}

func (session *LiveTunnelSession) Close() error {
	var closeErr error
	session.once.Do(func() {
		_ = session.closeTelemetryStream(context.Background())
		session.cancel()
		session.closeStreams()
		closeErr = session.tunnel.Close()
		<-session.done
	})
	return closeErr
}

func (session *LiveTunnelSession) RequestSigning(ctx context.Context, payload string) (string, error) {
	message, err := tunnelprotocol.ParseSigningControlMessage(payload)
	if err != nil {
		return "", err
	}
	if message == nil || message.Request == nil {
		return "", fmt.Errorf("signing request payload is required")
	}
	requestID := message.Request.RequestID
	response := make(chan liveSigningResponse, 1)
	session.mutex.Lock()
	if _, exists := session.signing[requestID]; exists {
		session.mutex.Unlock()
		return "", fmt.Errorf("duplicate signing request id")
	}
	session.signing[requestID] = response
	session.mutex.Unlock()
	if err := session.writeRawControl(ctx, payload); err != nil {
		session.removeSigningRequest(requestID)
		return "", err
	}
	select {
	case result := <-response:
		return result.payload, result.err
	case <-ctx.Done():
		session.removeSigningRequest(requestID)
		return "", ctx.Err()
	case <-session.done:
		return "", fmt.Errorf("live tunnel session is closed")
	}
}

type LiveTunnelEgressTokenProvider struct {
	state *liveTunnelEgressTokenProviderState
}

type liveTunnelEgressTokenProviderState struct {
	mutex        sync.Mutex
	session      *LiveTunnelSession
	generation   uint64
	attached     bool
	token        string
	actingUserID *string
	expiresAt    string
	expiresAtMS  uint64
}

func (session *LiveTunnelSession) EgressTokenProvider(actingUserID *string) LiveTunnelEgressTokenProvider {
	return LiveTunnelEgressTokenProvider{
		state: &liveTunnelEgressTokenProviderState{
			session:      session,
			attached:     true,
			actingUserID: cloneStringPointer(actingUserID),
		},
	}
}

func (provider LiveTunnelEgressTokenProvider) AttachSession(session *LiveTunnelSession) error {
	if provider.state == nil {
		return fmt.Errorf("live tunnel egress token provider state is required")
	}
	if session == nil {
		return fmt.Errorf("live tunnel session is required")
	}
	provider.state.mutex.Lock()
	defer provider.state.mutex.Unlock()
	provider.state.generation++
	provider.state.session = session
	provider.state.attached = true
	provider.state.token = ""
	provider.state.expiresAt = ""
	provider.state.expiresAtMS = 0
	return nil
}

func (provider LiveTunnelEgressTokenProvider) SetActingUserID(actingUserID *string) error {
	if provider.state == nil {
		return fmt.Errorf("live tunnel egress token provider state is required")
	}
	provider.state.mutex.Lock()
	defer provider.state.mutex.Unlock()
	if stringPointerEqual(provider.state.actingUserID, actingUserID) {
		return nil
	}
	provider.state.generation++
	provider.state.actingUserID = cloneStringPointer(actingUserID)
	provider.state.token = ""
	provider.state.expiresAt = ""
	provider.state.expiresAtMS = 0
	return nil
}

func (provider LiveTunnelEgressTokenProvider) Detach() error {
	if provider.state == nil {
		return fmt.Errorf("live tunnel egress token provider state is required")
	}
	provider.state.mutex.Lock()
	defer provider.state.mutex.Unlock()
	provider.state.generation++
	provider.state.attached = false
	provider.state.session = nil
	provider.state.token = ""
	provider.state.expiresAt = ""
	provider.state.expiresAtMS = 0
	return nil
}

func (provider LiveTunnelEgressTokenProvider) Token() (tunnelprotocol.EgressToken, error) {
	if provider.state == nil {
		return tunnelprotocol.EgressToken{}, fmt.Errorf("live tunnel egress token provider state is required")
	}
	provider.state.mutex.Lock()
	if !provider.state.attached {
		provider.state.mutex.Unlock()
		return tunnelprotocol.EgressToken{}, fmt.Errorf("gateway egress token provider is not attached to the bootstrap session")
	}
	session := provider.state.session
	if session == nil {
		provider.state.mutex.Unlock()
		return tunnelprotocol.EgressToken{}, fmt.Errorf("live tunnel session is required")
	}
	nowMS := session.clock.NowMS()
	generation := provider.state.generation
	actingUserID := cloneStringPointer(provider.state.actingUserID)
	if provider.state.token != "" && nowMS < provider.state.expiresAtMS {
		token := provider.state.token
		expiresAt := provider.state.expiresAt
		expiresAtMS := provider.state.expiresAtMS
		provider.state.mutex.Unlock()
		return tunnelprotocol.EgressToken{
			Token:     token,
			ExpiresAt: expiresAt,
			TTLMS:     expiresAtMS - nowMS,
		}, nil
	}
	provider.state.mutex.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	response, err := session.requestEgressToken(ctx, actingUserID)
	if err != nil {
		return tunnelprotocol.EgressToken{}, err
	}
	provider.state.mutex.Lock()
	defer provider.state.mutex.Unlock()
	if provider.state.generation != generation {
		return tunnelprotocol.EgressToken{}, fmt.Errorf("egress token request completed after provider generation changed")
	}
	provider.state.token = response.token
	provider.state.expiresAt = response.expiresAt
	provider.state.expiresAtMS = addDurationMS(nowMS, response.ttlMS)
	return tunnelprotocol.EgressToken{
		Token:     response.token,
		ExpiresAt: response.expiresAt,
		TTLMS:     response.ttlMS,
	}, nil
}

func (session *LiveTunnelSession) RequestEgressToken(ctx context.Context, actingUserID *string) (string, error) {
	response, err := session.requestEgressToken(ctx, actingUserID)
	if err != nil {
		return "", err
	}
	return response.token, nil
}

func (session *LiveTunnelSession) requestEgressToken(ctx context.Context, actingUserID *string) (liveEgressTokenResponse, error) {
	requestID := fmt.Sprintf("egress_token_req_%d", session.nextEgressTokenRequestID.Add(1))
	response := make(chan liveEgressTokenResponse, 1)
	session.mutex.Lock()
	if _, exists := session.egressTokens[requestID]; exists {
		session.mutex.Unlock()
		return liveEgressTokenResponse{}, fmt.Errorf("duplicate egress token request id")
	}
	session.egressTokens[requestID] = response
	session.mutex.Unlock()
	session.recordEgressTokenEvent(ctx, telemetryEventEgressStarted, requestID, nil)

	payload, err := tunnelprotocol.EgressTokenRequestPayload(tunnelprotocol.EgressTokenRequest{
		MessageType:  "egress.token.request",
		RequestID:    requestID,
		ActingUserID: actingUserID,
	})
	if err != nil {
		session.removeEgressTokenRequest(requestID)
		return liveEgressTokenResponse{}, err
	}
	if err := session.writeRawControl(ctx, payload); err != nil {
		session.removeEgressTokenRequest(requestID)
		session.recordEgressTokenEvent(ctx, telemetryEventEgressFailed, requestID, map[string]any{"error": err.Error()})
		return liveEgressTokenResponse{}, err
	}
	select {
	case result := <-response:
		return result, result.err
	case <-ctx.Done():
		session.removeEgressTokenRequest(requestID)
		return liveEgressTokenResponse{}, ctx.Err()
	case <-session.done:
		return liveEgressTokenResponse{}, fmt.Errorf("live tunnel session is closed")
	}
}

func (session *LiveTunnelSession) run(ctx context.Context) {
	defer func() {
		session.markDisconnected()
		session.failPendingSigningRequests(fmt.Errorf("live tunnel session is closed"))
		session.failPendingEgressTokenRequests(fmt.Errorf("live tunnel session is closed"))
		close(session.done)
	}()
	go session.runPublishLoop(ctx)
	for {
		if session.runConnected(ctx) != liveTunnelConnectionRestartRequired {
			return
		}
		if err := session.reconnect(ctx); err != nil {
			return
		}
	}
}

type liveTunnelConnectionResult string

const (
	liveTunnelConnectionClosed          liveTunnelConnectionResult = "closed"
	liveTunnelConnectionRestartRequired liveTunnelConnectionResult = "restart_required"
)

func (session *LiveTunnelSession) runConnected(ctx context.Context) liveTunnelConnectionResult {
	for {
		messageType, payload, err := session.connection.Read(ctx)
		if err != nil {
			if ctx.Err() == nil && isGatewayServiceRestartClose(err) && session.reconnectConfigured() {
				session.failPendingSigningRequests(fmt.Errorf("bootstrap tunnel session restarted before a signing result arrived"))
				session.failPendingEgressTokenRequests(fmt.Errorf("bootstrap tunnel session restarted before an egress token arrived"))
				session.closeStreamsForBootstrapClose(err.Error())
				session.markDisconnected()
				return liveTunnelConnectionRestartRequired
			}
			if ctx.Err() == nil && !isExpectedWebSocketClose(err) {
				payload, payloadErr := tunnelprotocol.StreamReset(1, tunnelprotocol.StreamResetCodeTargetClosed, err.Error())
				_ = session.writeControl(context.Background(), payload, payloadErr)
			}
			if ctx.Err() == nil {
				session.closeStreamsForBootstrapClose(err.Error())
			}
			return liveTunnelConnectionClosed
		}
		switch messageType {
		case websocket.MessageText:
			if err := session.handleControl(ctx, string(payload)); err != nil {
				return liveTunnelConnectionClosed
			}
		case websocket.MessageBinary:
			frame, err := tunnelprotocol.DecodeStreamDataFrame(payload)
			if err != nil {
				session.recordDroppedBootstrapDataFrame(ctx, err.Error())
				continue
			}
			if err := session.handleDataFrame(ctx, frame); err != nil {
				return liveTunnelConnectionClosed
			}
		}
	}
}

func (session *LiveTunnelSession) reconnectConfigured() bool {
	return session.gatewayWSURL != "" && strings.TrimSpace(session.tunnelExchangeToken) != ""
}

func (session *LiveTunnelSession) reconnect(ctx context.Context) error {
	exchangeURL, err := ResolveTunnelExchangeURL(session.gatewayWSURL)
	if err != nil {
		return err
	}
	attempt := 0
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		attemptNumber := attempt + 1
		session.updateTunnelSupervisionDetails("restart_attempt", attemptNumber, nil)
		if session.supervisorHandle != nil {
			session.supervisorHandle.MarkComponentStarting(supervision.ComponentTunnelSession)
		}
		result, err := ExchangeTunnelToken(ctx, session.tunnelExchangeHTTPClient, exchangeURL, session.tunnelExchangeToken)
		if err != nil {
			var exchangeErr *TunnelExchangeError
			if errors.As(err, &exchangeErr) && exchangeErr.Kind == TunnelExchangeErrorRetryable {
				session.recordReconnectFailure("token_exchange_failed", attemptNumber, err)
				session.scheduleReconnectRetry(ctx, attempt, attemptNumber)
				attempt++
				continue
			}
			session.recordReconnectFailure("token_exchange_terminal", attemptNumber, err)
			return err
		}
		session.tunnelExchangeToken = result.TunnelExchangeToken
		tunnel, err := ConnectBootstrapTunnel(ctx, session.gatewayWSURL, result.BootstrapToken)
		if err != nil {
			session.recordReconnectFailure("bootstrap_connect_failed", attemptNumber, err)
			session.scheduleReconnectRetry(ctx, attempt, attemptNumber)
			attempt++
			continue
		}
		session.writeMutex.Lock()
		session.tunnel = tunnel
		session.connection = tunnel.connection
		session.writeMutex.Unlock()
		session.markConnected()
		if err := session.publishInitialRuntimeReadiness(ctx); err != nil {
			return err
		}
		if err := session.openTelemetryStream(ctx); err != nil {
			return err
		}
		if err := session.openOperationStream(ctx); err != nil {
			return err
		}
		return nil
	}
}

func sleepReconnectBackoff(ctx context.Context, attempt int) {
	backoff := tunnelReconnectBackoff(attempt)
	timer := time.NewTimer(backoff)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}

func tunnelReconnectBackoff(attempt int) time.Duration {
	backoff := DefaultTunnelReconnectBackoff[len(DefaultTunnelReconnectBackoff)-1]
	if attempt < len(DefaultTunnelReconnectBackoff) {
		backoff = DefaultTunnelReconnectBackoff[attempt]
	}
	return backoff
}

func isGatewayServiceRestartClose(err error) bool {
	var closeErr websocket.CloseError
	return errors.As(err, &closeErr) &&
		closeErr.Code == GatewayServiceRestartCloseCode &&
		closeErr.Reason == GatewayServiceRestartCloseReason
}

func (session *LiveTunnelSession) runPublishLoop(ctx context.Context) {
	ticker := time.NewTicker(DefaultLiveTunnelPublishInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := session.publishKeepalive(ctx); err != nil {
				session.cancel()
				return
			}
			if err := session.publishRuntimeReadiness(ctx); err != nil {
				session.cancel()
				return
			}
			session.forwardSupervisorLifecycleEvents(ctx)
		}
	}
}

func (session *LiveTunnelSession) markConnected() {
	session.keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
		manager.OnTunnelConnected(session.clock)
	})
	session.runtimeReadinessManager.OnTunnelConnected()
	session.updateTunnelSupervisionDetails("", 0, nil)
	if session.supervisorHandle != nil {
		session.supervisorHandle.MarkComponentHealthy(supervision.ComponentTunnelSession)
	}
}

func (session *LiveTunnelSession) markDisconnected() {
	session.keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
		manager.OnTunnelDisconnected()
	})
	session.runtimeReadinessManager.OnTunnelDisconnected()
}

func (session *LiveTunnelSession) recordReconnectFailure(reason string, attemptNumber int, err error) {
	session.updateTunnelSupervisionDetails(reason, attemptNumber, nil)
	if session.supervisorHandle == nil {
		return
	}
	errorText := err.Error()
	session.supervisorHandle.MarkComponentRestarting(supervision.ComponentTunnelSession, errorText)
	session.supervisorHandle.EmitComponentHealthcheckFailed(
		supervision.ComponentTunnelSession,
		reason,
		errorText,
		"bootstrap_connection",
		nil,
	)
}

func (session *LiveTunnelSession) scheduleReconnectRetry(ctx context.Context, attempt int, attemptNumber int) {
	backoff := tunnelReconnectBackoff(attempt)
	session.updateTunnelSupervisionDetails("retry_after_failure", attemptNumber, &backoff)
	if session.supervisorHandle != nil {
		session.supervisorHandle.EmitComponentRestartScheduled(
			supervision.ComponentTunnelSession,
			"retry_after_failure",
			uint64(backoff.Milliseconds()),
			nil,
		)
	}
	sleepReconnectBackoff(ctx, attempt)
}

func (session *LiveTunnelSession) updateTunnelSupervisionDetails(reason string, attemptNumber int, backoff *time.Duration) {
	if session.supervisorHandle == nil {
		return
	}
	details := map[string]string{"gatewayWsUrl": session.gatewayWSURL}
	if reason != "" {
		details["lastReconnectReason"] = reason
	}
	if attemptNumber > 0 {
		details["reconnectAttempt"] = strconv.Itoa(attemptNumber)
	}
	if backoff != nil {
		details["reconnectBackoffMs"] = strconv.FormatInt(backoff.Milliseconds(), 10)
	}
	session.supervisorHandle.ReplaceComponentDetails(supervision.ComponentTunnelSession, details)
}

func (session *LiveTunnelSession) publishInitialRuntimeReadiness(ctx context.Context) error {
	state := session.runtimeReadinessManager.TakeInitialPublishableState()
	if state == nil {
		return fmt.Errorf("runtime readiness manager did not produce an initial state after tunnel attachment")
	}
	return session.writeJSONControl(ctx, state)
}

func (session *LiveTunnelSession) publishKeepalive(ctx context.Context) error {
	var state *mistleprotocol.KeepaliveState
	session.keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
		state = manager.TakePublishableState(session.clock)
	})
	if state == nil {
		return nil
	}
	return session.writeJSONControl(ctx, state)
}

func (session *LiveTunnelSession) publishRuntimeReadiness(ctx context.Context) error {
	state := session.runtimeReadinessManager.TakePublishableState()
	if state == nil {
		return nil
	}
	return session.writeJSONControl(ctx, state)
}

func (session *LiveTunnelSession) writeJSONControl(ctx context.Context, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return session.writeRawControl(ctx, string(payload))
}

func (session *LiveTunnelSession) handleControl(ctx context.Context, payload string) error {
	if handled, err := session.handleOperationControl(ctx, payload); handled || err != nil {
		return err
	}
	if handled, err := session.handleTelemetryControl(ctx, payload); handled || err != nil {
		return err
	}
	if handled, err := session.handleSigningControl(payload); handled || err != nil {
		return err
	}
	if handled, err := session.handleEgressTokenControl(payload); handled || err != nil {
		return err
	}
	if handled, err := session.handlePortsControl(ctx, payload); handled || err != nil {
		return err
	}
	if handled, err := session.handlePortsTransportControl(ctx, payload); handled || err != nil {
		return err
	}
	if handled, err := session.handlePTYSessionControl(ctx, payload); handled || err != nil {
		return err
	}
	message, err := tunnelprotocol.ParseStreamControlMessage(payload)
	if err != nil {
		session.recordDroppedBootstrapControlMessage(ctx, err.Error())
		return nil
	}
	switch {
	case message.Open != nil:
		return session.handleOpen(ctx, *message.Open)
	case message.Close != nil:
		return session.handleClose(ctx, message.Close.StreamID)
	case message.Window != nil:
		return session.addWindow(ctx, message.Window.StreamID, message.Window.Bytes)
	case message.Signal != nil:
		payload, payloadErr := tunnelprotocol.StreamReset(
			message.Signal.StreamID,
			tunnelprotocol.StreamResetCodeInvalidStreamSignal,
			"stream.signal is not supported on bootstrap tunnel streams",
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	return nil
}

func (session *LiveTunnelSession) recordDroppedBootstrapControlMessage(ctx context.Context, reason string) {
	session.recordDroppedBootstrapMessage(ctx, telemetryEventControlDropped, "control message", reason)
}

func (session *LiveTunnelSession) recordDroppedBootstrapDataFrame(ctx context.Context, reason string) {
	session.recordDroppedBootstrapMessage(ctx, telemetryEventFrameDropped, "data frame", reason)
}

func (session *LiveTunnelSession) recordDroppedBootstrapMessage(ctx context.Context, event string, droppedKind string, reason string) {
	message := fmt.Sprintf("sandboxd dropped bootstrap %s: %s", droppedKind, reason)
	if err := session.recordTelemetryLog(ctx, telemetryLogLevelWarn, event, map[string]any{
		"component":         "TunnelSession",
		"sandboxInstanceId": session.sandboxInstanceID,
		"message":           message,
		"reason":            reason,
	}); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to publish telemetry event %q: %v\n", event, err)
	}
}

func (session *LiveTunnelSession) handleSigningControl(payload string) (bool, error) {
	message, err := tunnelprotocol.ParseSigningControlMessage(payload)
	if err != nil {
		return true, nil
	}
	if message == nil {
		return false, nil
	}
	if message.SuccessResult != nil {
		session.completeSigningRequest(message.SuccessResult.RequestID, liveSigningResponse{payload: payload})
		return true, nil
	}
	if message.FailureResult != nil {
		session.completeSigningRequest(message.FailureResult.RequestID, liveSigningResponse{payload: payload})
		return true, nil
	}
	return true, nil
}

func (session *LiveTunnelSession) handleEgressTokenControl(payload string) (bool, error) {
	message, err := tunnelprotocol.ParseEgressTokenControlMessage(payload)
	if err != nil {
		return true, nil
	}
	if message == nil {
		return false, nil
	}
	if message.Response != nil {
		session.completeEgressTokenRequest(message.Response.RequestID, liveEgressTokenResponse{
			token:     message.Response.Token,
			expiresAt: message.Response.ExpiresAt,
			ttlMS:     message.Response.TTLMS,
		})
		session.recordEgressTokenEvent(context.Background(), telemetryEventEgressCompleted, message.Response.RequestID, map[string]any{
			"expiresAt": message.Response.ExpiresAt,
			"ttlMs":     message.Response.TTLMS,
		})
		return true, nil
	}
	if message.Error != nil {
		session.completeEgressTokenRequest(message.Error.RequestID, liveEgressTokenResponse{
			err: fmt.Errorf("%s: %s", message.Error.Code, message.Error.Message),
		})
		session.recordEgressTokenEvent(context.Background(), telemetryEventEgressFailed, message.Error.RequestID, map[string]any{
			"code":  message.Error.Code,
			"error": message.Error.Message,
		})
		return true, nil
	}
	return true, nil
}

func (session *LiveTunnelSession) handlePortsControl(ctx context.Context, payload string) (bool, error) {
	message, err := tunnelprotocol.ParsePortsControlMessage(payload)
	if err != nil {
		return true, nil
	}
	if message == nil {
		return false, nil
	}
	if message.TargetAuthorize != nil {
		decision, err := AuthorizeTargetPort(session.clock, message.TargetAuthorize.Target)
		if err != nil {
			return true, err
		}
		if decision.Authorized {
			payload, payloadErr := tunnelprotocol.PortsTargetAuthorizeSuccessResult(
				message.TargetAuthorize.RequestID,
				decision.UpstreamProtocol,
				decision.WebsocketCapable,
			)
			return true, session.writeControl(ctx, payload, payloadErr)
		}
		payload, payloadErr := tunnelprotocol.PortsTargetAuthorizeFailureResult(
			message.TargetAuthorize.RequestID,
			decision.RejectionReason,
		)
		return true, session.writeControl(ctx, payload, payloadErr)
	}
	return true, nil
}

func (session *LiveTunnelSession) handlePortsTransportControl(ctx context.Context, payload string) (bool, error) {
	message, err := tunnelprotocol.ParsePortsTransportMessage(payload)
	if err != nil {
		return true, nil
	}
	if message == nil {
		return false, nil
	}
	switch {
	case message.TCPOpen != nil:
		return true, session.openPortAccessTCPStream(ctx, *message.TCPOpen)
	case message.TCPConnected != nil:
		return true, fmt.Errorf("ports.tcp.connected streamId %d must not be sent from the gateway to sandboxd", message.TCPConnected.StreamID)
	case message.TCPClose != nil:
		return true, session.closePortAccessTCPDirection(ctx, *message.TCPClose)
	case message.TCPError != nil:
		return true, fmt.Errorf("ports.tcp.error streamId %d must not be sent from the gateway to sandboxd", message.TCPError.StreamID)
	case message.HTTPOpen != nil:
		return true, session.openPortAccessHTTPStream(ctx, *message.HTTPOpen)
	case message.HTTPBodyChunk != nil:
		return true, session.handlePortAccessHTTPBodyChunk(*message.HTTPBodyChunk)
	case message.HTTPBodyEnd != nil:
		return true, session.handlePortAccessHTTPBodyEnd(*message.HTTPBodyEnd)
	case message.StreamClose != nil:
		return true, session.closePortAccessStream(*message.StreamClose)
	case message.StreamError != nil:
		return true, fmt.Errorf("ports.stream.error streamId %d must not be sent from the gateway to sandboxd", message.StreamError.StreamID)
	default:
		return true, nil
	}
}

func (session *LiveTunnelSession) handleOpen(ctx context.Context, message tunnelprotocol.StreamOpen) error {
	if session.streamActive(message.StreamID) {
		payload, payloadErr := tunnelprotocol.StreamOpenError(
			message.StreamID,
			tunnelprotocol.ConnectErrorCodeInvalidConnectRequest,
			fmt.Sprintf("stream.open streamId %d already exists", message.StreamID),
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	switch message.Channel.Kind {
	case "agent":
		return session.openAgentStream(ctx, message.StreamID)
	case "processes":
		return session.openProcessesStream(ctx, message.StreamID)
	case "fileUpload":
		return session.openFileUploadStream(ctx, message)
	case "exec":
		return session.openExecStream(ctx, message)
	case "fileSearch":
		return session.openFileSearchStream(ctx, message)
	default:
		payload, payloadErr := tunnelprotocol.StreamOpenError(
			message.StreamID,
			tunnelprotocol.ConnectErrorCodeUnsupportedChannel,
			fmt.Sprintf("unsupported stream channel kind %q", message.Channel.Kind),
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
}

func (session *LiveTunnelSession) openFileUploadStream(ctx context.Context, message tunnelprotocol.StreamOpen) error {
	upload, err := CreateFileUploadState(message.Channel, session.attachmentRoot, session.clock)
	if err != nil {
		payload, payloadErr := tunnelprotocol.StreamOpenError(
			message.StreamID,
			tunnelprotocol.ConnectErrorCodeInvalidConnectRequest,
			err.Error(),
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	session.mutex.Lock()
	session.streams[message.StreamID] = &liveTunnelStream{
		kind:   "fileUpload",
		upload: upload,
		window: tunnelprotocol.DefaultStreamWindowBytes,
	}
	session.mutex.Unlock()
	payload, payloadErr := tunnelprotocol.StreamOpenOK(message.StreamID)
	if err := session.writeControl(ctx, payload, payloadErr); err != nil {
		session.closeStream(message.StreamID)
		return err
	}
	return nil
}

func (session *LiveTunnelSession) openExecStream(ctx context.Context, message tunnelprotocol.StreamOpen) error {
	streamCtx, cancel := context.WithCancel(context.Background())
	session.mutex.Lock()
	runtimeEnv := cloneStringMap(session.runtimeEnv)
	session.streams[message.StreamID] = &liveTunnelStream{
		kind:   "exec",
		cancel: cancel,
		window: tunnelprotocol.DefaultStreamWindowBytes,
	}
	session.mutex.Unlock()
	payload, payloadErr := tunnelprotocol.StreamOpenOK(message.StreamID)
	if err := session.writeControl(ctx, payload, payloadErr); err != nil {
		session.closeStream(message.StreamID)
		return err
	}
	go session.runExecStream(streamCtx, message, runtimeEnv)
	return nil
}

func (session *LiveTunnelSession) runExecStream(ctx context.Context, message tunnelprotocol.StreamOpen, runtimeEnv map[string]string) {
	result, err := RunExecStreamCommand(ctx, message.Channel, runtimeEnv)
	if err != nil {
		if ctx.Err() == context.Canceled {
			return
		}
		session.closeStream(message.StreamID)
		payload, payloadErr := tunnelprotocol.StreamReset(message.StreamID, tunnelprotocol.StreamResetCodeExecCommandFailed, err.Error())
		_ = session.writeControl(context.Background(), payload, payloadErr)
		return
	}
	payload, payloadErr := tunnelprotocol.ExecResultEvent(message.StreamID, result.ExitCode, result.Stdout, result.Stderr, result.Truncated)
	if err := session.writeControl(context.Background(), payload, payloadErr); err != nil {
		session.closeStream(message.StreamID)
		return
	}
	completePayload, completeErr := tunnelprotocol.StreamComplete(message.StreamID)
	if err := session.writeControl(context.Background(), completePayload, completeErr); err != nil {
		session.closeStream(message.StreamID)
		return
	}
	session.closeStream(message.StreamID)
}

func (session *LiveTunnelSession) openFileSearchStream(ctx context.Context, message tunnelprotocol.StreamOpen) error {
	if _, err := FileSearchRoot(message.Channel); err != nil {
		payload, payloadErr := tunnelprotocol.StreamOpenError(
			message.StreamID,
			tunnelprotocol.ConnectErrorCodeFileSearchUnavailable,
			err.Error(),
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	streamCtx, cancel := context.WithCancel(context.Background())
	commands := make(chan fileSearchCommand, 64)
	session.mutex.Lock()
	session.streams[message.StreamID] = &liveTunnelStream{
		kind:       "fileSearch",
		channel:    message.Channel,
		cancel:     cancel,
		fileSearch: commands,
		window:     tunnelprotocol.DefaultStreamWindowBytes,
	}
	session.mutex.Unlock()
	payload, payloadErr := tunnelprotocol.StreamOpenOK(message.StreamID)
	if err := session.writeControl(ctx, payload, payloadErr); err != nil {
		session.closeStream(message.StreamID)
		return err
	}
	go session.runFileSearchStream(streamCtx, message.StreamID, message.Channel, commands)
	return nil
}

func (session *LiveTunnelSession) openAgentStream(ctx context.Context, streamID uint32) error {
	session.mutex.Lock()
	agentEndpoint := session.agentEndpoint
	session.mutex.Unlock()
	if agentEndpoint == "" {
		payload, payloadErr := tunnelprotocol.StreamOpenError(
			streamID,
			tunnelprotocol.ConnectErrorCodeAgentEndpointDialFailed,
			"agent runtime endpoint is not available",
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	openCtx, cancel := context.WithCancel(context.Background())
	session.mutex.Lock()
	session.pendingAgentOpens[streamID] = cancel
	session.mutex.Unlock()
	go session.finishAgentStreamOpen(openCtx, streamID, agentEndpoint)
	return nil
}

func (session *LiveTunnelSession) finishAgentStreamOpen(ctx context.Context, streamID uint32, agentEndpoint string) {
	agentConnection, _, err := websocket.Dial(ctx, agentEndpoint, nil)
	if err != nil {
		if ctx.Err() != nil {
			session.removePendingAgentOpen(streamID)
			return
		}
		if !session.consumePendingAgentOpen(streamID) {
			return
		}
		payload, payloadErr := tunnelprotocol.StreamOpenError(
			streamID,
			tunnelprotocol.ConnectErrorCodeAgentEndpointDialFailed,
			"failed to connect agent runtime endpoint: "+err.Error(),
		)
		_ = session.writeControl(context.Background(), payload, payloadErr)
		return
	}
	agentConnection.SetReadLimit(tunnelWebSocketReadLimitBytes)
	streamCtx, cancel := context.WithCancel(context.Background())
	session.mutex.Lock()
	pending := session.pendingAgentOpens[streamID]
	if pending == nil {
		session.mutex.Unlock()
		cancel()
		agentConnection.CloseNow()
		return
	}
	delete(session.pendingAgentOpens, streamID)
	session.streams[streamID] = &liveTunnelStream{
		kind:       "agent",
		agent:      agentConnection,
		cancel:     cancel,
		window:     tunnelprotocol.AgentStreamWindowBytes,
		agentStats: &agentStreamStats{openedAtMS: session.clock.NowMS()},
	}
	session.mutex.Unlock()
	payload, payloadErr := tunnelprotocol.StreamOpenOK(streamID)
	if err := session.writeControl(context.Background(), payload, payloadErr); err != nil {
		cancel()
		agentConnection.CloseNow()
		return
	}
	go session.forwardAgentToTunnel(streamCtx, streamID, agentConnection)
}

func (session *LiveTunnelSession) openProcessesStream(ctx context.Context, streamID uint32) error {
	if _, err := CollectProcessesSnapshot(session.clock); err != nil {
		payload, payloadErr := tunnelprotocol.StreamOpenError(
			streamID,
			tunnelprotocol.ConnectErrorCodeProcessesStreamUnavailable,
			err.Error(),
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	session.mutex.Lock()
	session.streams[streamID] = &liveTunnelStream{
		kind:   "processes",
		window: tunnelprotocol.DefaultStreamWindowBytes,
	}
	session.mutex.Unlock()
	payload, payloadErr := tunnelprotocol.StreamOpenOK(streamID)
	if err := session.writeControl(ctx, payload, payloadErr); err != nil {
		session.closeStream(streamID)
		return err
	}
	return session.sendProcessesSnapshot(ctx, streamID)
}

func (session *LiveTunnelSession) handleDataFrame(ctx context.Context, frame tunnelprotocol.StreamDataFrame) error {
	stream := session.stream(frame.StreamID)
	if stream == nil {
		payload, payloadErr := tunnelprotocol.StreamReset(
			frame.StreamID,
			tunnelprotocol.StreamResetCodeInvalidStreamData,
			fmt.Sprintf("stream data frame streamId %d is not bound to an active tunnel stream", frame.StreamID),
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	switch stream.kind {
	case "agent":
		return session.forwardTunnelFrameToAgent(ctx, frame, stream)
	case "processes":
		return session.handleProcessesFrame(ctx, frame)
	case "fileUpload":
		return session.handleFileUploadFrame(ctx, frame, stream)
	case "fileSearch":
		return session.handleFileSearchFrame(ctx, frame, stream)
	case "portAccessTCP":
		return session.handlePortAccessTCPFrame(ctx, frame, stream)
	default:
		return nil
	}
}

func (session *LiveTunnelSession) handleFileUploadFrame(ctx context.Context, frame tunnelprotocol.StreamDataFrame, stream *liveTunnelStream) error {
	if frame.PayloadKind != tunnelprotocol.PayloadKindRawBytes {
		session.closeStream(frame.StreamID)
		payload, payloadErr := tunnelprotocol.StreamReset(
			frame.StreamID,
			tunnelprotocol.StreamResetCodeInvalidStreamData,
			"file upload stream only accepts raw byte payloads",
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	if err := stream.upload.Write(frame.Payload); err != nil {
		session.removeStream(frame.StreamID)
		var reset fileUploadResetError
		if errors.As(err, &reset) {
			payload, payloadErr := tunnelprotocol.StreamReset(frame.StreamID, reset.code, reset.message)
			return session.writeControl(ctx, payload, payloadErr)
		}
		return err
	}
	payload, payloadErr := tunnelprotocol.StreamWindowCredit(frame.StreamID, len(frame.Payload))
	return session.writeControl(ctx, payload, payloadErr)
}

func (session *LiveTunnelSession) forwardTunnelFrameToAgent(ctx context.Context, frame tunnelprotocol.StreamDataFrame, stream *liveTunnelStream) error {
	switch frame.PayloadKind {
	case tunnelprotocol.PayloadKindWebSocketText:
		recordAgentInboundMessage(stream, len(frame.Payload))
		return stream.agent.Write(ctx, websocket.MessageText, frame.Payload)
	case tunnelprotocol.PayloadKindWebSocketBinary:
		recordAgentInboundMessage(stream, len(frame.Payload))
		return stream.agent.Write(ctx, websocket.MessageBinary, frame.Payload)
	default:
		session.closeStream(frame.StreamID)
		payload, payloadErr := tunnelprotocol.StreamReset(
			frame.StreamID,
			tunnelprotocol.StreamResetCodeInvalidStreamData,
			"agent stream only accepts websocket text or binary payload kinds",
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
}

func (session *LiveTunnelSession) handleProcessesFrame(ctx context.Context, frame tunnelprotocol.StreamDataFrame) error {
	if frame.PayloadKind != tunnelprotocol.PayloadKindWebSocketText {
		session.closeStream(frame.StreamID)
		payload, payloadErr := tunnelprotocol.StreamReset(
			frame.StreamID,
			tunnelprotocol.StreamResetCodeInvalidStreamData,
			"processes stream only accepts websocket text payloads",
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	message, err := tunnelprotocol.ParseProcessesStreamMessage(string(frame.Payload))
	if err != nil {
		session.closeStream(frame.StreamID)
		payload, payloadErr := tunnelprotocol.StreamReset(
			frame.StreamID,
			tunnelprotocol.StreamResetCodeInvalidStreamData,
			err.Error(),
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	if message.Snapshot != nil {
		session.closeStream(frame.StreamID)
		payload, payloadErr := tunnelprotocol.StreamReset(
			frame.StreamID,
			tunnelprotocol.StreamResetCodeInvalidStreamData,
			"processes stream does not accept processes.snapshot payloads from the gateway",
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	payload, payloadErr := tunnelprotocol.StreamWindowCredit(frame.StreamID, len(frame.Payload))
	if err := session.writeControl(ctx, payload, payloadErr); err != nil {
		return err
	}
	return session.sendProcessesSnapshot(ctx, frame.StreamID)
}

func (session *LiveTunnelSession) handleFileSearchFrame(ctx context.Context, frame tunnelprotocol.StreamDataFrame, stream *liveTunnelStream) error {
	if frame.PayloadKind != tunnelprotocol.PayloadKindWebSocketText {
		session.closeStream(frame.StreamID)
		payload, payloadErr := tunnelprotocol.StreamReset(
			frame.StreamID,
			tunnelprotocol.StreamResetCodeInvalidStreamData,
			"fileSearch stream only accepts websocket text payloads",
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	message, err := tunnelprotocol.ParseFileSearchStreamMessage(string(frame.Payload))
	if err != nil {
		session.closeStream(frame.StreamID)
		payload, payloadErr := tunnelprotocol.StreamReset(
			frame.StreamID,
			tunnelprotocol.StreamResetCodeInvalidStreamData,
			err.Error(),
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	if message.Results != nil || message.Error != nil {
		session.closeStream(frame.StreamID)
		payload, payloadErr := tunnelprotocol.StreamReset(
			frame.StreamID,
			tunnelprotocol.StreamResetCodeInvalidStreamData,
			"fileSearch stream does not accept "+fileSearchMessageType(message)+" payloads from the gateway",
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	payload, payloadErr := tunnelprotocol.StreamWindowCredit(frame.StreamID, len(frame.Payload))
	if err := session.writeControl(ctx, payload, payloadErr); err != nil {
		return err
	}
	if message.Select != nil {
		return session.sendFileSearchCommand(ctx, stream, fileSearchCommand{})
	}
	return session.sendFileSearchCommand(ctx, stream, fileSearchCommand{query: message.Query})
}

func (session *LiveTunnelSession) sendFileSearchCommand(ctx context.Context, stream *liveTunnelStream, command fileSearchCommand) error {
	if stream.fileSearch == nil {
		return nil
	}
	select {
	case stream.fileSearch <- command:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (session *LiveTunnelSession) runFileSearchStream(ctx context.Context, streamID uint32, channel tunnelprotocol.StreamChannel, commands <-chan fileSearchCommand) {
	for {
		var first fileSearchCommand
		select {
		case <-ctx.Done():
			return
		case command := <-commands:
			if command.query == nil {
				continue
			}
			first = command
		}
		command, ok := latestDebouncedFileSearchCommand(ctx, commands, first)
		if !ok {
			return
		}
		if !session.streamActive(streamID) {
			return
		}
		items, err := SearchFiles(channel, *command.query)
		var payload string
		var payloadErr error
		if err != nil {
			payload, payloadErr = tunnelprotocol.FileSearchErrorPayload(command.query.RequestID, "search_failed", err.Error())
		} else {
			payload, payloadErr = tunnelprotocol.FileSearchResultsPayload(command.query.RequestID, command.query.Query, items)
		}
		if !session.streamActive(streamID) {
			return
		}
		if err := session.writeStreamPayload(context.Background(), streamID, payload, payloadErr); err != nil {
			session.closeStream(streamID)
			return
		}
	}
}

func latestDebouncedFileSearchCommand(ctx context.Context, commands <-chan fileSearchCommand, first fileSearchCommand) (fileSearchCommand, bool) {
	timer := time.NewTimer(defaultFileSearchDebounce)
	defer timer.Stop()
	latest := first
	for {
		select {
		case <-ctx.Done():
			return fileSearchCommand{}, false
		case command := <-commands:
			if command.query != nil {
				latest = command
			}
		case <-timer.C:
			return latest, true
		}
	}
}

func fileSearchMessageType(message tunnelprotocol.FileSearchStreamMessage) string {
	if message.Query != nil {
		return message.Query.MessageType
	}
	if message.Select != nil {
		return message.Select.MessageType
	}
	if message.Results != nil {
		return message.Results.MessageType
	}
	if message.Error != nil {
		return message.Error.MessageType
	}
	return "unknown"
}

func (session *LiveTunnelSession) forwardAgentToTunnel(ctx context.Context, streamID uint32, agentConnection *websocket.Conn) {
	for {
		messageType, payload, err := agentConnection.Read(ctx)
		if err != nil {
			stream := session.removeStreamForSummary(streamID)
			if ctx.Err() == nil && !isExpectedWebSocketClose(err) {
				payload, payloadErr := tunnelprotocol.StreamReset(
					streamID,
					tunnelprotocol.StreamResetCodeTargetClosed,
					"agent runtime websocket closed",
				)
				_ = session.writeControl(context.Background(), payload, payloadErr)
				session.publishAgentStreamSummary(context.Background(), streamID, stream, "reset", "runtime", tunnelprotocol.StreamResetCodeTargetClosed, "agent runtime websocket closed")
			} else {
				session.publishAgentStreamSummary(context.Background(), streamID, stream, "closed", "runtime", "", "")
			}
			return
		}
		payloadKind := tunnelprotocol.PayloadKindWebSocketBinary
		if messageType == websocket.MessageText {
			payloadKind = tunnelprotocol.PayloadKindWebSocketText
		}
		if err := session.writeStreamFrame(ctx, streamID, payloadKind, payload); err != nil {
			return
		}
	}
}

func (session *LiveTunnelSession) sendProcessesSnapshot(ctx context.Context, streamID uint32) error {
	snapshot, err := CollectProcessesSnapshot(session.clock)
	if err != nil {
		session.closeStream(streamID)
		payload, payloadErr := tunnelprotocol.StreamReset(streamID, tunnelprotocol.StreamResetCodeProcessesSnapshotFailed, err.Error())
		return session.writeControl(ctx, payload, payloadErr)
	}
	payload, err := tunnelprotocol.ProcessesSnapshotPayload(snapshot)
	if err != nil {
		session.closeStream(streamID)
		return err
	}
	return session.writeStreamFrame(ctx, streamID, tunnelprotocol.PayloadKindWebSocketText, []byte(payload))
}

func (session *LiveTunnelSession) writeStreamPayload(ctx context.Context, streamID uint32, payload string, err error) error {
	if err != nil {
		session.closeStream(streamID)
		return err
	}
	return session.writeStreamFrame(ctx, streamID, tunnelprotocol.PayloadKindWebSocketText, []byte(payload))
}

func (session *LiveTunnelSession) writeStreamFrame(ctx context.Context, streamID uint32, payloadKind byte, payload []byte) error {
	var thresholdTelemetry []agentStreamThresholdTelemetry
	session.mutex.Lock()
	stream := session.streams[streamID]
	if stream == nil {
		session.mutex.Unlock()
		return nil
	}
	if stream.window < uint64(len(payload)) {
		delete(session.streams, streamID)
		session.mutex.Unlock()
		if stream.kind == "agent" {
			session.publishAgentWindowExhausted(ctx, streamID, stream, payloadKind, len(payload))
		}
		payload, payloadErr := tunnelprotocol.StreamReset(
			streamID,
			tunnelprotocol.StreamResetCodeStreamWindowExhausted,
			stream.kind+" stream send window is exhausted",
		)
		if stream.kind == "agent" {
			session.publishAgentStreamSummary(ctx, streamID, stream, "reset", "runtime", tunnelprotocol.StreamResetCodeStreamWindowExhausted, "agent stream send window is exhausted")
		}
		return session.writeControl(ctx, payload, payloadErr)
	}
	stream.window -= uint64(len(payload))
	if stream.kind == "agent" {
		recordAgentOutboundMessage(stream, len(payload), session.clock.NowMS(), tunnelprotocol.AgentStreamWindowBytes-stream.window)
		for _, thresholdBytes := range stream.agentStats.takeNewThresholdCrossings(tunnelprotocol.AgentStreamWindowBytes - stream.window) {
			thresholdTelemetry = append(thresholdTelemetry, agentStreamThresholdTelemetry{
				streamID:         streamID,
				payloadKind:      payloadKind,
				payloadBytes:     len(payload),
				availableBytes:   stream.window,
				outstandingBytes: tunnelprotocol.AgentStreamWindowBytes - stream.window,
				thresholdBytes:   thresholdBytes,
				messageCountOut:  stream.agentStats.messageCountOut,
				streamAgeMS:      session.clock.NowMS() - stream.agentStats.openedAtMS,
				oldestUnackedMS:  stream.agentStats.oldestUnackedAgeMS(session.clock.NowMS()),
			})
		}
	}
	stream.lastSent = session.clock.NowSystemTime()
	session.mutex.Unlock()

	for _, telemetry := range thresholdTelemetry {
		session.publishAgentWindowThresholdCrossed(ctx, telemetry)
	}

	encoded, err := tunnelprotocol.EncodeStreamDataFrame(streamID, payloadKind, payload)
	if err != nil {
		return err
	}
	session.writeMutex.Lock()
	defer session.writeMutex.Unlock()
	return session.connection.Write(ctx, websocket.MessageBinary, encoded)
}

func (session *LiveTunnelSession) writeControl(ctx context.Context, payload string, err error) error {
	if err != nil {
		return err
	}
	return session.writeRawControl(ctx, payload)
}

func (session *LiveTunnelSession) writeRawControl(ctx context.Context, payload string) error {
	session.writeMutex.Lock()
	defer session.writeMutex.Unlock()
	return session.connection.Write(ctx, websocket.MessageText, []byte(payload))
}

func (session *LiveTunnelSession) handleClose(ctx context.Context, streamID uint32) error {
	stream := session.stream(streamID)
	if stream == nil {
		payload, payloadErr := tunnelprotocol.StreamReset(
			streamID,
			tunnelprotocol.StreamResetCodeInvalidStreamClose,
			fmt.Sprintf("stream.close streamId %d is not bound to an active tunnel stream", streamID),
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	if stream.kind != "fileUpload" {
		if stream.kind == "agent" {
			session.publishAgentStreamSummary(ctx, streamID, stream, "closed", "gateway", "", "")
		}
		session.closeStream(streamID)
		return nil
	}

	session.removeStream(streamID)
	completed, err := stream.upload.Finalize()
	if err != nil {
		var reset fileUploadResetError
		if errors.As(err, &reset) {
			payload, payloadErr := tunnelprotocol.StreamReset(streamID, reset.code, reset.message)
			return session.writeControl(ctx, payload, payloadErr)
		}
		return err
	}
	payload, payloadErr := tunnelprotocol.FileUploadCompletedEvent(
		streamID,
		completed.kind,
		completed.attachmentID,
		completed.threadID,
		completed.originalFilename,
		completed.mimeType,
		completed.sizeBytes,
		completed.path,
	)
	if err := session.writeControl(ctx, payload, payloadErr); err != nil {
		return err
	}
	completePayload, completeErr := tunnelprotocol.StreamComplete(streamID)
	return session.writeControl(ctx, completePayload, completeErr)
}

func (session *LiveTunnelSession) addWindow(ctx context.Context, streamID uint32, bytes uint64) error {
	session.mutex.Lock()
	stream := session.streams[streamID]
	if stream == nil {
		session.mutex.Unlock()
		payload, payloadErr := tunnelprotocol.StreamReset(
			streamID,
			tunnelprotocol.StreamResetCodeInvalidStreamWindow,
			fmt.Sprintf("stream.window streamId %d is not bound to an active tunnel stream", streamID),
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	if bytes > tunnelprotocol.MaxStreamWindowBytes || stream.window > tunnelprotocol.MaxStreamWindowBytes-bytes {
		session.mutex.Unlock()
		payload, payloadErr := tunnelprotocol.StreamReset(
			streamID,
			tunnelprotocol.StreamResetCodeInvalidStreamWindow,
			fmt.Sprintf("stream.window credit exceeds configured maximum of %d bytes", tunnelprotocol.MaxStreamWindowBytes),
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	if stream.kind == "agent" {
		recordAgentCreditRestore(stream, bytes, session.clock.NowMS())
	}
	stream.window += bytes
	session.mutex.Unlock()
	return nil
}

func (session *LiveTunnelSession) streamActive(streamID uint32) bool {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	return session.streams[streamID] != nil || session.pendingAgentOpens[streamID] != nil
}

func (session *LiveTunnelSession) stream(streamID uint32) *liveTunnelStream {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	return session.streams[streamID]
}

func (session *LiveTunnelSession) closeStream(streamID uint32) {
	session.mutex.Lock()
	stream := session.streams[streamID]
	delete(session.streams, streamID)
	pendingAgentOpen := session.pendingAgentOpens[streamID]
	delete(session.pendingAgentOpens, streamID)
	session.mutex.Unlock()
	if pendingAgentOpen != nil {
		pendingAgentOpen()
	}
	if stream == nil {
		return
	}
	if stream.cancel != nil {
		stream.cancel()
	}
	if stream.agent != nil {
		_ = stream.agent.Close(websocket.StatusNormalClosure, "")
	}
	if stream.upload != nil {
		stream.upload.Cleanup()
	}
	if stream.httpBodyWriter != nil {
		_ = stream.httpBodyWriter.Close()
	}
	if stream.tcpConnection != nil {
		_ = stream.tcpConnection.Close()
	}
}

func (session *LiveTunnelSession) removeStream(streamID uint32) {
	session.mutex.Lock()
	delete(session.streams, streamID)
	session.mutex.Unlock()
}

func (session *LiveTunnelSession) removeStreamForSummary(streamID uint32) *liveTunnelStream {
	session.mutex.Lock()
	stream := session.streams[streamID]
	delete(session.streams, streamID)
	session.mutex.Unlock()
	return stream
}

func (session *LiveTunnelSession) closeStreams() {
	session.mutex.Lock()
	streamIDs := make([]uint32, 0, len(session.streams)+len(session.pendingAgentOpens))
	for streamID := range session.streams {
		streamIDs = append(streamIDs, streamID)
	}
	for streamID := range session.pendingAgentOpens {
		streamIDs = append(streamIDs, streamID)
	}
	session.mutex.Unlock()
	for _, streamID := range streamIDs {
		session.closeStream(streamID)
	}
}

func (session *LiveTunnelSession) closeStreamsForBootstrapClose(reason string) {
	session.mutex.Lock()
	streamIDs := make([]uint32, 0, len(session.streams)+len(session.pendingAgentOpens))
	for streamID := range session.streams {
		streamIDs = append(streamIDs, streamID)
	}
	for streamID := range session.pendingAgentOpens {
		streamIDs = append(streamIDs, streamID)
	}
	session.mutex.Unlock()
	for _, streamID := range streamIDs {
		stream := session.stream(streamID)
		if stream != nil && stream.kind == "agent" {
			session.bufferAgentStreamSummary(streamID, stream, "bootstrap_closed", "bootstrap", "", reason)
		}
		session.closeStream(streamID)
	}
}

func (session *LiveTunnelSession) removePendingAgentOpen(streamID uint32) {
	session.mutex.Lock()
	delete(session.pendingAgentOpens, streamID)
	session.mutex.Unlock()
}

func (session *LiveTunnelSession) consumePendingAgentOpen(streamID uint32) bool {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if session.pendingAgentOpens[streamID] == nil {
		return false
	}
	delete(session.pendingAgentOpens, streamID)
	return true
}

func (session *LiveTunnelSession) completeSigningRequest(requestID string, response liveSigningResponse) {
	session.mutex.Lock()
	channel := session.signing[requestID]
	delete(session.signing, requestID)
	session.mutex.Unlock()
	if channel != nil {
		channel <- response
	}
}

func (session *LiveTunnelSession) removeSigningRequest(requestID string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	delete(session.signing, requestID)
}

func (session *LiveTunnelSession) completeEgressTokenRequest(requestID string, response liveEgressTokenResponse) {
	session.mutex.Lock()
	channel := session.egressTokens[requestID]
	delete(session.egressTokens, requestID)
	session.mutex.Unlock()
	if channel != nil {
		channel <- response
	}
}

func (session *LiveTunnelSession) removeEgressTokenRequest(requestID string) {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	delete(session.egressTokens, requestID)
}

func (session *LiveTunnelSession) failPendingSigningRequests(err error) {
	session.mutex.Lock()
	pending := session.signing
	session.signing = map[string]chan liveSigningResponse{}
	session.mutex.Unlock()
	for _, channel := range pending {
		channel <- liveSigningResponse{err: err}
	}
}

func (session *LiveTunnelSession) failPendingEgressTokenRequests(err error) {
	session.mutex.Lock()
	pending := session.egressTokens
	session.egressTokens = map[string]chan liveEgressTokenResponse{}
	session.mutex.Unlock()
	for _, channel := range pending {
		channel <- liveEgressTokenResponse{err: err}
	}
}

func isExpectedWebSocketClose(err error) bool {
	if err == nil || err == context.Canceled || err == io.EOF {
		return true
	}
	var closeErr websocket.CloseError
	return websocket.CloseStatus(err) != -1 || websocket.CloseStatus(err) == closeErr.Code
}

func DecodeLiveTunnelDataFrame(payload []byte) (tunnelprotocol.StreamDataFrame, map[string]any, error) {
	frame, err := tunnelprotocol.DecodeStreamDataFrame(payload)
	if err != nil {
		return tunnelprotocol.StreamDataFrame{}, nil, err
	}
	if frame.PayloadKind != tunnelprotocol.PayloadKindWebSocketText {
		return frame, nil, nil
	}
	var decoded map[string]any
	if err := json.Unmarshal(frame.Payload, &decoded); err != nil {
		return frame, nil, err
	}
	return frame, decoded, nil
}

func cloneStringMap(source map[string]string) map[string]string {
	if source == nil {
		return nil
	}
	cloned := make(map[string]string, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func cloneStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func stringPointerEqual(left *string, right *string) bool {
	switch {
	case left == nil && right == nil:
		return true
	case left == nil || right == nil:
		return false
	default:
		return *left == *right
	}
}

func addDurationMS(base uint64, duration uint64) uint64 {
	if duration > ^uint64(0)-base {
		return ^uint64(0)
	}
	return base + duration
}
