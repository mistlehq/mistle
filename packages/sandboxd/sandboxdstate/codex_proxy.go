package sandboxdstate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/codexproxy"
	"github.com/mistle/sandboxd/idempotency"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
)

const CodexProxyRawConnectivityTimeout = 500 * time.Millisecond
const codexSetDeliveryContextMethod = "mistle/setDeliveryContext"
const codexThreadCompactStartMethod = "thread/compact/start"
const codexTurnInterruptMethod = "turn/interrupt"

var codexProxyLogOutput io.Writer = os.Stderr

type codexProxyClientKind string

const (
	codexProxyClientKindUnknown           codexProxyClientKind = "unknown"
	codexProxyClientKindMistleAgentClient codexProxyClientKind = "mistle_agent_client"
	codexProxyClientKindOther             codexProxyClientKind = "other"
)

type CodexProxyPlan struct {
	ListenURL string
	RawURL    string
}

type CodexProxyHandle struct {
	listenURL        string
	server           *http.Server
	sessionManager   *codexproxy.SessionManagerHandle
	controlHandle    CodexProxyControlHandle
	supervisorHandle *supervision.SandboxdSupervisorHandle
	done             chan struct{}
	once             sync.Once
}

type CodexProxyControlHandle struct {
	sessionManager   *codexproxy.SessionManagerHandle
	supervisorHandle *supervision.SandboxdSupervisorHandle
}

func StartCodexProxy(
	plan CodexProxyPlan,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	keepaliveManager *keepalive.SharedManager,
) (*CodexProxyHandle, error) {
	return startCodexProxy(plan, supervisorHandle, keepaliveManager, nil)
}

func StartCodexProxyWithIdempotencyStore(
	plan CodexProxyPlan,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	keepaliveManager *keepalive.SharedManager,
	store *idempotency.Store,
) (*CodexProxyHandle, error) {
	if store == nil {
		return nil, fmt.Errorf("Codex idempotency store is required")
	}
	return startCodexProxy(plan, supervisorHandle, keepaliveManager, newCodexSharedIdempotencyStore(store))
}

func startCodexProxy(
	plan CodexProxyPlan,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	keepaliveManager *keepalive.SharedManager,
	idempotencyStore *CodexSharedIdempotencyStore,
) (*CodexProxyHandle, error) {
	listenAddress, err := listenAddressFromWebSocketURL(plan.ListenURL)
	if err != nil {
		return nil, err
	}
	if _, err := url.ParseRequestURI(plan.RawURL); err != nil {
		return nil, fmt.Errorf("codex proxy raw target URL is invalid: %w", err)
	}

	supervisorHandle.ReplaceComponentDetails(supervision.ComponentCodexProxy, map[string]string{
		"listenAddr": plan.ListenURL,
		"rawTarget":  plan.RawURL,
	})
	supervisorHandle.MarkComponentStarting(supervision.ComponentCodexProxy)
	healthSink := codexProxyHealthSink{
		supervisorHandle: supervisorHandle,
		listenURL:        plan.ListenURL,
		rawURL:           plan.RawURL,
	}
	sessionManager := codexproxy.StartSessionManager(plan.RawURL, keepaliveManager, healthSink)

	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		sessionManager.Close()
		supervisorHandle.MarkComponentRestarting(supervision.ComponentCodexProxy, err.Error())
		return nil, fmt.Errorf("failed to start codex proxy listener: %w", err)
	}
	resolvedListenURL, err := resolvedCodexProxyWebSocketURL(plan.ListenURL, listener.Addr())
	if err != nil {
		sessionManager.Close()
		if closeErr := listener.Close(); closeErr != nil {
			return nil, fmt.Errorf("failed to close codex proxy listener after URL resolution failure: %w", closeErr)
		}
		supervisorHandle.MarkComponentRestarting(supervision.ComponentCodexProxy, err.Error())
		return nil, err
	}
	healthSink.listenURL = resolvedListenURL
	supervisorHandle.SetComponentDetail(supervision.ComponentCodexProxy, "listenAddr", resolvedListenURL)
	supervisorHandle.SetComponentDetail(supervision.ComponentCodexProxy, "rawTarget", plan.RawURL)

	proxy := &codexProxyServer{
		rawURL:               plan.RawURL,
		supervisorHandle:     supervisorHandle,
		sessionManagerHandle: sessionManager,
		idempotencyStore:     idempotencyStore,
	}
	server := &http.Server{Handler: proxy}
	handle := &CodexProxyHandle{
		listenURL:      resolvedListenURL,
		server:         server,
		sessionManager: sessionManager,
		controlHandle: CodexProxyControlHandle{
			sessionManager:   sessionManager,
			supervisorHandle: supervisorHandle,
		},
		supervisorHandle: supervisorHandle,
		done:             make(chan struct{}),
	}

	go func() {
		defer close(handle.done)
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			supervisorHandle.MarkComponentRestarting(supervision.ComponentCodexProxy, err.Error())
			supervisorHandle.EmitComponentExited(supervision.ComponentCodexProxy, "runtime_thread_returned", errorStringPointer(err.Error()), nil)
		}
	}()

	if err := proxy.checkRawConnectivity(); err != nil {
		_ = handle.Close()
		supervisorHandle.MarkComponentRestarting(supervision.ComponentCodexProxy, err.Error())
		return nil, fmt.Errorf("failed to connect codex proxy raw target: %w", err)
	}
	waitForCodexProxySessionManagerHealth(supervisorHandle, CodexProxyRawConnectivityTimeout)
	return handle, nil
}

func (handle *CodexProxyHandle) ListenURL() string {
	return handle.listenURL
}

func (handle *CodexProxyHandle) ControlHandle() CodexProxyControlHandle {
	return handle.controlHandle
}

func (handle *CodexProxyHandle) Close() error {
	var closeErr error
	handle.once.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		closeErr = handle.server.Shutdown(ctx)
		handle.sessionManager.Close()
		<-handle.done
		handle.supervisorHandle.MarkComponentStopped(supervision.ComponentCodexProxy)
	})
	return closeErr
}

func (handle CodexProxyControlHandle) Snapshot() *supervision.ComponentHealthSnapshot {
	if handle.supervisorHandle == nil {
		return nil
	}
	return handle.supervisorHandle.ComponentSnapshot(supervision.ComponentCodexProxy)
}

func (handle CodexProxyControlHandle) RequestRestart() error {
	if handle.sessionManager == nil {
		return fmt.Errorf("Codex proxy session manager is required")
	}
	return handle.sessionManager.Restart()
}

func CodexProxyPlanFromRuntimePlan(runtimePlan runtime.CompiledRuntimePlan) (*CodexProxyPlan, error) {
	for _, agentRuntime := range runtimePlan.AgentRuntimes {
		if agentRuntime.RuntimeID != "codex" {
			continue
		}
		runtimeClient, err := findRuntimeClient(runtimePlan, agentRuntime.RuntimeID, agentRuntime.ClientID)
		if err != nil {
			return nil, err
		}
		endpoint, err := findRuntimeClientWSEndpoint(runtimeClient, agentRuntime.RuntimeID, agentRuntime.EndpointKey)
		if err != nil {
			return nil, err
		}
		if endpoint.ConnectionMode != "dedicated" {
			return nil, fmt.Errorf("runtime %q endpoint uses unsupported connection mode %q", agentRuntime.RuntimeID, endpoint.ConnectionMode)
		}
		processSpec, err := findRuntimeClientProcess(runtimeClient, agentRuntime.RuntimeID, agentRuntime.RuntimeKey)
		if err != nil {
			return nil, err
		}
		if processSpec.Readiness.Type != runtime.RuntimeClientProcessReadinessWS {
			return nil, fmt.Errorf("runtime %q process %q must use websocket readiness so sandboxd can attach its proxy adapter", agentRuntime.RuntimeID, processSpec.ProcessKey)
		}
		if processSpec.Readiness.URL == "" {
			return nil, fmt.Errorf("runtime %q process %q readiness URL is required", agentRuntime.RuntimeID, processSpec.ProcessKey)
		}
		return &CodexProxyPlan{
			ListenURL: endpoint.Transport.URL,
			RawURL:    processSpec.Readiness.URL,
		}, nil
	}
	return nil, nil
}

type codexProxyServer struct {
	rawURL               string
	supervisorHandle     *supervision.SandboxdSupervisorHandle
	sessionManagerHandle *codexproxy.SessionManagerHandle
	idempotencyStore     *CodexSharedIdempotencyStore
}

func (proxy *codexProxyServer) ServeHTTP(responseWriter http.ResponseWriter, request *http.Request) {
	ctx := request.Context()
	clientConnection, err := websocket.Accept(responseWriter, request, nil)
	if err != nil {
		return
	}
	defer clientConnection.CloseNow()

	rawConnection, _, err := websocket.Dial(ctx, proxy.rawURL, nil)
	if err != nil {
		proxy.markDisconnected(err)
		_ = clientConnection.Close(websocket.StatusTryAgainLater, "codex app-server unavailable")
		return
	}
	defer rawConnection.CloseNow()

	proxy.markRawConnected()
	relayCodexWebSockets(ctx, clientConnection, rawConnection, proxy.sessionManagerHandle, proxy.idempotencyStore)
}

func (proxy *codexProxyServer) checkRawConnectivity() error {
	ctx, cancel := context.WithTimeout(context.Background(), CodexProxyRawConnectivityTimeout)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, proxy.rawURL, nil)
	if err != nil {
		return err
	}
	if err := connection.Close(websocket.StatusNormalClosure, "codex proxy connectivity check"); err != nil {
		return nil
	}
	return nil
}

func (proxy *codexProxyServer) markRawConnected() {
	proxy.supervisorHandle.ReplaceComponentDetails(supervision.ComponentCodexProxy, map[string]string{
		"listenAddr":           currentComponentDetail(proxy.supervisorHandle, supervision.ComponentCodexProxy, "listenAddr"),
		"rawTarget":            proxy.rawURL,
		"sessionManagerState":  currentComponentDetail(proxy.supervisorHandle, supervision.ComponentCodexProxy, "sessionManagerState"),
		"rawConnectivityState": "Connected",
	})
	proxy.supervisorHandle.RecordComponentHealthcheck(supervision.ComponentCodexProxy)
}

func (proxy *codexProxyServer) markDisconnected(err error) {
	proxy.supervisorHandle.ReplaceComponentDetails(supervision.ComponentCodexProxy, map[string]string{
		"listenAddr":           currentComponentDetail(proxy.supervisorHandle, supervision.ComponentCodexProxy, "listenAddr"),
		"rawTarget":            proxy.rawURL,
		"sessionManagerState":  "Disconnected",
		"rawConnectivityState": "Disconnected",
		"lastProxyError":       err.Error(),
	})
	proxy.supervisorHandle.MarkComponentRestarting(supervision.ComponentCodexProxy, err.Error())
}

func relayCodexWebSockets(
	ctx context.Context,
	clientConnection *websocket.Conn,
	rawConnection *websocket.Conn,
	sessionManagerHandle *codexproxy.SessionManagerHandle,
	idempotencyStore *CodexSharedIdempotencyStore,
) {
	relayState := &codexRelayState{
		pendingIdempotency: map[string]codexStartedOperation{},
		idempotencyStore:   idempotencyStore,
		clientKind:         codexProxyClientKindUnknown,
		pendingRequests:    map[string]codexPendingRequest{},
		activeTurns:        map[string]codexActiveTurn{},
		pendingCompactions: map[string]codexPendingCompaction{},
		activeCompactions:  map[string]codexActiveCompaction{},
	}
	relayDone := make(chan struct{}, 2)
	go relayClientToRawCodexMessages(ctx, clientConnection, rawConnection, relayState, relayDone)
	go relayRawToClientCodexMessages(ctx, rawConnection, clientConnection, sessionManagerHandle, relayState, relayDone)
	<-relayDone
	finalizeCodexActiveTurnsForTransportOutcome(relayState, "transport_closed")
}

type codexRelayState struct {
	mutex              sync.Mutex
	pendingIdempotency map[string]codexStartedOperation
	idempotencyStore   *CodexSharedIdempotencyStore
	clientKind         codexProxyClientKind
	pendingRequests    map[string]codexPendingRequest
	deliveryContext    *codexDeliveryContextPayload
	activeTurns        map[string]codexActiveTurn
	pendingCompactions map[string]codexPendingCompaction
	activeCompactions  map[string]codexActiveCompaction
}

type codexPendingRequest struct {
	method               string
	threadID             string
	expectedTurnID       string
	interruptionSource   string
	interruptionExpected bool
	compactionTrigger    string
	deliveryContext      *codexDeliveryContextPayload
	startedAt            time.Time
}

type codexActiveTurn struct {
	requestKind          string
	threadID             string
	turnID               string
	deliveryContext      *codexDeliveryContextPayload
	startedAt            time.Time
	firstItem            bool
	firstItemType        string
	interruptionSource   string
	interruptionExpected *bool
}

type codexPendingCompaction struct {
	threadID        string
	trigger         string
	deliveryContext *codexDeliveryContextPayload
	startedAt       time.Time
}

type codexActiveCompaction struct {
	itemID          string
	threadID        string
	turnID          string
	trigger         string
	deliveryContext *codexDeliveryContextPayload
	startedAt       time.Time
	requestedAt     time.Time
}

type codexDeliveryContextSource string

const (
	codexDeliveryContextSourceSchedule codexDeliveryContextSource = "schedule"
	codexDeliveryContextSourceWebhook  codexDeliveryContextSource = "webhook"
)

type codexDeliveryContextPayload struct {
	Traceparent        string                     `json:"traceparent"`
	Tracestate         *string                    `json:"tracestate"`
	Baggage            *string                    `json:"baggage"`
	Source             codexDeliveryContextSource `json:"source"`
	WebhookEventID     *string                    `json:"webhookEventId"`
	ScheduledActionID  *string                    `json:"scheduledActionId"`
	DeliveryTaskID     string                     `json:"deliveryTaskId"`
	ExternalDeliveryID *string                    `json:"externalDeliveryId"`
	TriggerRunID       string                     `json:"triggerRunId"`
	ConversationID     string                     `json:"conversationId"`
	SandboxInstanceID  string                     `json:"sandboxInstanceId"`
	RouteID            *string                    `json:"routeId"`
}

func relayClientToRawCodexMessages(ctx context.Context, source *websocket.Conn, destination *websocket.Conn, relayState *codexRelayState, done chan<- struct{}) {
	defer func() {
		_ = destination.Close(websocket.StatusNormalClosure, "peer closed")
		done <- struct{}{}
	}()
	for {
		messageType, payload, err := source.Read(ctx)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				_ = destination.Close(websocket.StatusInternalError, "websocket relay failed")
			}
			return
		}
		preparedPayload, forward, err := prepareCodexClientPayloadForForwarding(ctx, source, payload, relayState)
		if err != nil {
			return
		}
		if !forward {
			continue
		}
		payload = preparedPayload
		if err := destination.Write(ctx, messageType, payload); err != nil {
			return
		}
	}
}

func relayRawToClientCodexMessages(
	ctx context.Context,
	source *websocket.Conn,
	destination *websocket.Conn,
	sessionManagerHandle *codexproxy.SessionManagerHandle,
	relayState *codexRelayState,
	done chan<- struct{},
) {
	defer func() {
		_ = destination.Close(websocket.StatusNormalClosure, "peer closed")
		done <- struct{}{}
	}()
	incoming := startCodexRawRelayReader(ctx, source)
	retentionCompleted := make(chan struct{}, 32)
	bufferedResponses := []codexBufferedSuccessResponse{}
	for {
		select {
		case <-ctx.Done():
			return
		case <-retentionCompleted:
			if !flushReadyCodexResponses(ctx, destination, relayState, &bufferedResponses) {
				return
			}
		case message, ok := <-incoming:
			if !ok {
				return
			}
			if message.err != nil {
				if !errors.Is(message.err, io.EOF) {
					_ = destination.Close(websocket.StatusInternalError, "websocket relay failed")
				}
				return
			}
			observeCodexRawPayload(message.payload, relayState)
			bufferedResponse := codexBufferedSuccessResponse{
				messageType:     message.messageType,
				payload:         message.payload,
				retentionResult: nil,
			}
			if threadID, ok := codexThreadIDForRetainedSuccessResponse(message.payload, relayState); ok {
				retentionResult := make(chan error, 1)
				bufferedResponse.retentionResult = retentionResult
				go func(threadID string, result chan<- error) {
					result <- sessionManagerHandle.RetainThread(threadID, codexproxy.RetainReasonMistleAgentBackgroundExecution)
					retentionCompleted <- struct{}{}
				}(threadID, retentionResult)
			}
			bufferedResponses = append(bufferedResponses, bufferedResponse)
			if !flushReadyCodexResponses(ctx, destination, relayState, &bufferedResponses) {
				return
			}
		}
	}
}

type codexRawRelayMessage struct {
	messageType websocket.MessageType
	payload     []byte
	err         error
}

type codexBufferedSuccessResponse struct {
	messageType     websocket.MessageType
	payload         []byte
	retentionResult <-chan error
	retentionErr    error
	retentionReady  bool
}

func startCodexRawRelayReader(ctx context.Context, source *websocket.Conn) <-chan codexRawRelayMessage {
	incoming := make(chan codexRawRelayMessage, 32)
	go func() {
		defer close(incoming)
		for {
			messageType, payload, err := source.Read(ctx)
			select {
			case incoming <- codexRawRelayMessage{messageType: messageType, payload: payload, err: err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	return incoming
}

func flushReadyCodexResponses(
	ctx context.Context,
	destination *websocket.Conn,
	relayState *codexRelayState,
	bufferedResponses *[]codexBufferedSuccessResponse,
) bool {
	for len(*bufferedResponses) > 0 {
		response := &(*bufferedResponses)[0]
		if response.retentionResult != nil && !response.retentionReady {
			select {
			case response.retentionErr = <-response.retentionResult:
				response.retentionReady = true
			default:
				return true
			}
		}
		payload := response.payload
		messageType := response.messageType
		if response.retentionErr != nil {
			errorPayload, buildErr := codexRetentionErrorPayload(response.payload)
			if buildErr != nil {
				return writeCodexRetentionError(ctx, destination, response.payload) == nil
			}
			_ = completeCodexResponseIdempotency(response.payload, errorPayload, relayState)
			payload = errorPayload
			messageType = websocket.MessageText
		} else if err := completeCodexResponseIdempotency(response.payload, response.payload, relayState); err != nil {
			if err := writeCodexIdempotencyError(ctx, destination, codexJSONRPCIDFromPayload(response.payload), err.Error()); err != nil {
				return false
			}
			*bufferedResponses = (*bufferedResponses)[1:]
			continue
		}
		if err := destination.Write(ctx, messageType, payload); err != nil {
			return false
		}
		*bufferedResponses = (*bufferedResponses)[1:]
	}
	return true
}

func listenAddressFromWebSocketURL(rawURL string) (string, error) {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("codex proxy listen URL is invalid: %w", err)
	}
	if parsedURL.Scheme != "ws" {
		return "", fmt.Errorf("codex proxy listen URL must use ws scheme")
	}
	if parsedURL.Host == "" {
		return "", fmt.Errorf("codex proxy listen URL host is required")
	}
	return parsedURL.Host, nil
}

func resolvedCodexProxyWebSocketURL(rawURL string, address net.Addr) (string, error) {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("codex proxy listen URL is invalid: %w", err)
	}
	tcpAddress, ok := address.(*net.TCPAddr)
	if !ok {
		return "", fmt.Errorf("codex proxy listener address was not TCP: %s", address.String())
	}
	host := parsedURL.Hostname()
	if host == "" {
		return "", fmt.Errorf("codex proxy listen URL host is required")
	}
	parsedURL.Host = net.JoinHostPort(host, fmt.Sprint(tcpAddress.Port))
	return parsedURL.String(), nil
}

func prepareCodexClientPayloadForForwarding(
	ctx context.Context,
	clientConnection *websocket.Conn,
	payload []byte,
	relayState *codexRelayState,
) ([]byte, bool, error) {
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return payload, true, nil
	}
	if method, ok := decoded["method"].(string); ok && method == codexSetDeliveryContextMethod {
		deliveryContext, err := parseCodexDeliveryContextPayload(decoded["params"])
		if err != nil {
			return nil, false, err
		}
		relayState.mutex.Lock()
		relayState.deliveryContext = deliveryContext
		relayState.mutex.Unlock()
		emitCodexProxyLog("codex_proxy.delivery_context.received", codexDeliveryContextLogFields(deliveryContext))
		return nil, false, nil
	}
	observeCodexClientRequest(decoded, relayState)
	_, hasIdempotency := decoded["idempotency"]
	if !hasIdempotency {
		return payload, true, nil
	}
	requestID := decoded["id"]
	action := prepareCodexIdempotency(decoded, relayState.idempotencyStore)
	switch action.kind {
	case codexIdempotencyActionDisabled:
		serialized, err := json.Marshal(decoded)
		if err != nil {
			return nil, false, err
		}
		return serialized, true, nil
	case codexIdempotencyActionForward:
		requestKey, ok := codexJSONRPCIDKey(requestID)
		if ok {
			relayState.mutex.Lock()
			relayState.pendingIdempotency[requestKey] = *action.started
			relayState.mutex.Unlock()
		}
		serialized, err := json.Marshal(decoded)
		if err != nil {
			return nil, false, err
		}
		return serialized, true, nil
	case codexIdempotencyActionReplay:
		replayPayload := action.replay.Payload
		replayPayload["id"] = requestID
		serialized, err := json.Marshal(replayPayload)
		if err != nil {
			return nil, false, err
		}
		if err := clientConnection.Write(ctx, websocket.MessageText, serialized); err != nil {
			return nil, false, err
		}
		return nil, false, nil
	case codexIdempotencyActionReject:
		if err := writeCodexIdempotencyError(ctx, clientConnection, requestID, action.message); err != nil {
			return nil, false, err
		}
		return nil, false, nil
	default:
		return nil, false, fmt.Errorf("unsupported Codex idempotency action %q", action.kind)
	}
}

func observeCodexClientRequest(payload map[string]any, relayState *codexRelayState) {
	method, ok := payload["method"].(string)
	if !ok {
		return
	}
	if method == "initialize" {
		relayState.mutex.Lock()
		relayState.clientKind = codexClientKindFromInitializeRequest(payload)
		relayState.mutex.Unlock()
		return
	}
	requestKey, ok := codexJSONRPCIDKey(payload["id"])
	if !ok {
		return
	}
	pendingRequest := codexPendingRequest{
		method:          method,
		threadID:        codexThreadIDFromClientRequest(payload),
		deliveryContext: relayState.deliveryContext,
		startedAt:       time.Now(),
	}
	switch method {
	case "turn/start", "turn/steer":
		if method == "turn/steer" {
			pendingRequest.expectedTurnID = codexExpectedTurnIDFromClientRequest(payload)
		}
	case codexTurnInterruptMethod:
		pendingRequest.expectedTurnID = codexInterruptTurnIDFromClientRequest(payload)
		pendingRequest.interruptionSource = codexInterruptionSourceForClientKind(relayState.clientKind)
		pendingRequest.interruptionExpected = codexInterruptionExpectedForSource(pendingRequest.interruptionSource)
		observeCodexTurnInterruptRequested(pendingRequest, relayState)
	case codexThreadCompactStartMethod:
		pendingRequest.compactionTrigger = "manual"
	default:
		return
	}
	relayState.mutex.Lock()
	relayState.pendingRequests[requestKey] = pendingRequest
	relayState.mutex.Unlock()
}

func codexClientKindFromInitializeRequest(payload map[string]any) codexProxyClientKind {
	params, _ := payload["params"].(map[string]any)
	clientInfo, _ := params["clientInfo"].(map[string]any)
	title, _ := clientInfo["title"].(string)
	if title == codexproxy.MistleAgentClientTitle {
		return codexProxyClientKindMistleAgentClient
	}
	return codexProxyClientKindOther
}

func codexThreadIDFromClientRequest(payload map[string]any) string {
	params, _ := payload["params"].(map[string]any)
	threadID, _ := params["threadId"].(string)
	return threadID
}

func codexExpectedTurnIDFromClientRequest(payload map[string]any) string {
	params, _ := payload["params"].(map[string]any)
	expectedTurnID, _ := params["expectedTurnId"].(string)
	return expectedTurnID
}

func codexInterruptTurnIDFromClientRequest(payload map[string]any) string {
	params, _ := payload["params"].(map[string]any)
	turnID, _ := params["turnId"].(string)
	if turnID != "" {
		return turnID
	}
	expectedTurnID, _ := params["expectedTurnId"].(string)
	return expectedTurnID
}

func validateCodexDeliveryContextPayload(params any) error {
	_, err := parseCodexDeliveryContextPayload(params)
	return err
}

func parseCodexDeliveryContextPayload(params any) (*codexDeliveryContextPayload, error) {
	serialized, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("Codex delivery context payload is invalid: %w", err)
	}
	var payload codexDeliveryContextPayload
	if err := json.Unmarshal(serialized, &payload); err != nil {
		return nil, fmt.Errorf("Codex delivery context payload is invalid: %w", err)
	}
	if payload.Traceparent == "" {
		return nil, fmt.Errorf("Codex delivery context payload requires traceparent")
	}
	if payload.DeliveryTaskID == "" {
		return nil, fmt.Errorf("Codex delivery context payload requires deliveryTaskId")
	}
	if payload.TriggerRunID == "" {
		return nil, fmt.Errorf("Codex delivery context payload requires triggerRunId")
	}
	if payload.ConversationID == "" {
		return nil, fmt.Errorf("Codex delivery context payload requires conversationId")
	}
	if payload.SandboxInstanceID == "" {
		return nil, fmt.Errorf("Codex delivery context payload requires sandboxInstanceId")
	}
	switch payload.Source {
	case codexDeliveryContextSourceSchedule:
		if payload.ScheduledActionID == nil {
			return nil, fmt.Errorf("schedule delivery context requires scheduledActionId")
		}
		if payload.WebhookEventID != nil {
			return nil, fmt.Errorf("schedule delivery context must not include webhookEventId")
		}
	case codexDeliveryContextSourceWebhook:
		if payload.WebhookEventID == nil {
			return nil, fmt.Errorf("webhook delivery context requires webhookEventId")
		}
		if payload.ScheduledActionID != nil {
			return nil, fmt.Errorf("webhook delivery context must not include scheduledActionId")
		}
	default:
		return nil, fmt.Errorf("Codex delivery context source is not supported")
	}
	return &payload, nil
}

func completeCodexResponseIdempotency(originalPayload []byte, deliveredPayload []byte, relayState *codexRelayState) error {
	if relayState.idempotencyStore == nil {
		return nil
	}
	requestID := codexJSONRPCIDFromPayload(originalPayload)
	requestKey, ok := codexJSONRPCIDKey(requestID)
	if !ok {
		return nil
	}
	relayState.mutex.Lock()
	started, ok := relayState.pendingIdempotency[requestKey]
	if ok {
		delete(relayState.pendingIdempotency, requestKey)
	}
	relayState.mutex.Unlock()
	if !ok {
		return nil
	}
	var response map[string]any
	if err := json.Unmarshal(deliveredPayload, &response); err != nil {
		return err
	}
	return completeCodexIdempotency(relayState.idempotencyStore, started, codexStoredResponse{Payload: response})
}

func writeCodexIdempotencyError(ctx context.Context, connection *websocket.Conn, requestID any, message string) error {
	serialized, err := json.Marshal(map[string]any{
		"id": requestID,
		"error": map[string]any{
			"code":    codexIdempotencyErrorCode,
			"message": message,
		},
	})
	if err != nil {
		return err
	}
	return connection.Write(ctx, websocket.MessageText, serialized)
}

func codexJSONRPCIDFromPayload(payload []byte) any {
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil
	}
	return decoded["id"]
}

func codexJSONRPCIDKey(id any) (string, bool) {
	if id == nil {
		return "", false
	}
	serialized, err := json.Marshal(id)
	if err != nil {
		return "", false
	}
	return string(serialized), true
}

func currentComponentDetail(
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	component supervision.SupervisedComponent,
	key string,
) string {
	snapshot := supervisorHandle.ComponentSnapshot(component)
	if snapshot == nil {
		return ""
	}
	return snapshot.Details[key]
}

func errorStringPointer(value string) *string {
	return &value
}

type codexProxyHealthSink struct {
	supervisorHandle *supervision.SandboxdSupervisorHandle
	listenURL        string
	rawURL           string
}

func (sink codexProxyHealthSink) SetSessionManagerHealth(state codexproxy.SessionManagerHealthState) {
	sink.supervisorHandle.ReplaceComponentDetails(supervision.ComponentCodexProxy, map[string]string{
		"listenAddr":           sink.listenURL,
		"rawTarget":            sink.rawURL,
		"sessionManagerState":  string(state),
		"rawConnectivityState": string(state),
	})
	if state == codexproxy.SessionManagerConnected {
		sink.supervisorHandle.MarkComponentHealthy(supervision.ComponentCodexProxy)
		sink.supervisorHandle.RecordComponentHealthcheck(supervision.ComponentCodexProxy)
		return
	}
	sink.supervisorHandle.MarkComponentRestarting(supervision.ComponentCodexProxy, "Codex session manager is not connected")
}

func waitForCodexProxySessionManagerHealth(
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	timeout time.Duration,
) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		snapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentCodexProxy)
		if snapshot != nil &&
			snapshot.Details["sessionManagerState"] == string(codexproxy.SessionManagerConnected) &&
			snapshot.Details["rawConnectivityState"] == string(codexproxy.SessionManagerConnected) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func codexThreadIDForRetainedSuccessResponse(payload []byte, relayState *codexRelayState) (string, bool) {
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return "", false
	}
	requestKey, ok := codexJSONRPCIDKey(decoded["id"])
	if !ok {
		return "", false
	}
	relayState.mutex.Lock()
	clientKind := relayState.clientKind
	pendingRequest, ok := relayState.pendingRequests[requestKey]
	if ok {
		delete(relayState.pendingRequests, requestKey)
	}
	relayState.mutex.Unlock()
	if clientKind != codexProxyClientKindMistleAgentClient || !ok {
		return "", false
	}
	if _, hasError := decoded["error"]; hasError {
		observeCodexTurnRequestFailed(pendingRequest, decoded["error"])
		return "", false
	}
	if pendingRequest.method == codexThreadCompactStartMethod {
		observeCodexCompactionRequestAccepted(pendingRequest, relayState)
		return "", false
	}
	switch pendingRequest.method {
	case "turn/start", "turn/steer":
	default:
		return "", false
	}
	result, ok := decoded["result"].(map[string]any)
	if !ok {
		return "", false
	}
	if pendingRequest.threadID != "" && codexResponseHasTurnID(pendingRequest.method, result) {
		observeCodexTurnResponseMapping(pendingRequest, pendingRequest.threadID, codexTurnIDFromResponseResult(pendingRequest.method, result), relayState)
		return pendingRequest.threadID, true
	}
	if turn, ok := result["turn"].(map[string]any); ok {
		if threadID, ok := turn["threadId"].(string); ok && threadID != "" {
			turnID, _ := turn["id"].(string)
			observeCodexTurnResponseMapping(pendingRequest, threadID, turnID, relayState)
			return threadID, true
		}
	}
	if threadID, ok := result["threadId"].(string); ok && threadID != "" {
		observeCodexTurnResponseMapping(pendingRequest, threadID, codexTurnIDFromResponseResult(pendingRequest.method, result), relayState)
		return threadID, true
	}
	return "", false
}

func observeCodexTurnResponseMapping(
	pendingRequest codexPendingRequest,
	threadID string,
	turnID string,
	relayState *codexRelayState,
) {
	if pendingRequest.deliveryContext == nil || threadID == "" || turnID == "" {
		return
	}
	fields := codexDeliveryContextLogFields(pendingRequest.deliveryContext)
	fields["threadId"] = threadID
	fields["turnId"] = turnID
	fields["providerConversationId"] = threadID
	fields["providerExecutionId"] = turnID
	emitCodexProxyLog("codex_proxy.delivery_context.mapped", fields)
	fields["outcome"] = "started"
	fields["mistle.turn.request_kind"] = codexTurnRequestKind(pendingRequest.method)
	emitCodexProxyLog("codex_proxy.turn.started", fields)
	relayState.mutex.Lock()
	relayState.activeTurns[turnID] = codexActiveTurn{
		requestKind:     codexTurnRequestKind(pendingRequest.method),
		threadID:        threadID,
		turnID:          turnID,
		deliveryContext: pendingRequest.deliveryContext,
		startedAt:       pendingRequest.startedAt,
	}
	relayState.mutex.Unlock()
}

func observeCodexRawPayload(payload []byte, relayState *codexRelayState) {
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return
	}
	method, _ := decoded["method"].(string)
	switch method {
	case "turn/completed":
		params, _ := decoded["params"].(map[string]any)
		turn, _ := params["turn"].(map[string]any)
		turnID, _ := turn["id"].(string)
		status, _ := turn["status"].(string)
		if status == "" {
			status = "unknown"
		}
		relayState.mutex.Lock()
		activeTurn, ok := relayState.activeTurns[turnID]
		if ok {
			delete(relayState.activeTurns, turnID)
		}
		relayState.mutex.Unlock()
		if !ok || activeTurn.deliveryContext == nil {
			return
		}
		fields := codexActiveTurnLogFields(activeTurn)
		outcome, reason := codexTurnOutcomeAndReason(status, activeTurn)
		fields["outcome"] = outcome
		fields["reason"] = reason
		fields["durationMs"] = time.Since(activeTurn.startedAt).Milliseconds()
		if outcome == "interrupted" {
			applyCodexInterruptionFields(fields, activeTurn)
		}
		emitCodexProxyLog("codex_proxy.turn.completed", fields)
		if outcome == "interrupted" {
			emitCodexProxyLog("codex_proxy.turn.interrupted", fields)
		}
	case "item/started":
		observeCodexCompactionNotification(decoded, relayState, "codex.thread.compaction_started", "started")
		observeCodexTurnFirstItem(decoded, relayState)
	case "item/completed":
		observeCodexCompactionNotification(decoded, relayState, "codex.thread.compaction_completed", "completed")
	}
}

func observeCodexTurnInterruptRequested(pendingRequest codexPendingRequest, relayState *codexRelayState) {
	if pendingRequest.deliveryContext == nil || pendingRequest.threadID == "" || pendingRequest.expectedTurnID == "" {
		return
	}
	fields := codexDeliveryContextLogFields(pendingRequest.deliveryContext)
	fields["threadId"] = pendingRequest.threadID
	fields["providerConversationId"] = pendingRequest.threadID
	fields["providerExecutionId"] = pendingRequest.expectedTurnID
	fields["turnId"] = pendingRequest.expectedTurnID
	fields["outcome"] = "accepted"
	fields["reason"] = ""
	fields["durationMs"] = int64(0)
	fields["interruptionSource"] = pendingRequest.interruptionSource
	fields["interruptionExpected"] = pendingRequest.interruptionExpected
	fields["mistle.turn.interruption_source"] = pendingRequest.interruptionSource
	fields["mistle.turn.interruption_expected"] = pendingRequest.interruptionExpected
	emitCodexProxyLog("codex_proxy.turn.interrupt_requested", fields)
	relayState.mutex.Lock()
	activeTurn, ok := relayState.activeTurns[pendingRequest.expectedTurnID]
	if ok {
		activeTurn.interruptionSource = pendingRequest.interruptionSource
		activeTurn.interruptionExpected = &pendingRequest.interruptionExpected
		relayState.activeTurns[pendingRequest.expectedTurnID] = activeTurn
	}
	relayState.mutex.Unlock()
}

func observeCodexTurnRequestFailed(pendingRequest codexPendingRequest, errorValue any) {
	if pendingRequest.method == codexThreadCompactStartMethod {
		observeCodexCompactionRequestFailed(pendingRequest, errorValue)
		return
	}
	if pendingRequest.method == codexTurnInterruptMethod {
		observeCodexTurnInterruptRequestFailed(pendingRequest, errorValue)
		return
	}
	if pendingRequest.deliveryContext == nil {
		return
	}
	fields := codexDeliveryContextLogFields(pendingRequest.deliveryContext)
	fields["threadId"] = pendingRequest.threadID
	fields["providerConversationId"] = pendingRequest.threadID
	fields["providerExecutionId"] = pendingRequest.expectedTurnID
	fields["turnId"] = pendingRequest.expectedTurnID
	fields["outcome"] = "failed"
	fields["reason"] = "rpc_error"
	fields["durationMs"] = time.Since(pendingRequest.startedAt).Milliseconds()
	fields["mistle.turn.request_kind"] = codexTurnRequestKind(pendingRequest.method)
	if message := codexErrorMessage(errorValue); message != "" {
		fields["error"] = message
	}
	emitCodexProxyLog("codex_proxy.turn.request_failed", fields)
}

func observeCodexTurnInterruptRequestFailed(pendingRequest codexPendingRequest, errorValue any) {
	if pendingRequest.deliveryContext == nil || pendingRequest.threadID == "" || pendingRequest.expectedTurnID == "" {
		return
	}
	fields := codexDeliveryContextLogFields(pendingRequest.deliveryContext)
	fields["threadId"] = pendingRequest.threadID
	fields["providerConversationId"] = pendingRequest.threadID
	fields["providerExecutionId"] = pendingRequest.expectedTurnID
	fields["turnId"] = pendingRequest.expectedTurnID
	fields["outcome"] = "failed"
	fields["reason"] = codexErrorMessageOrDefault(errorValue, "rpc_error")
	fields["durationMs"] = time.Since(pendingRequest.startedAt).Milliseconds()
	fields["interruptionSource"] = pendingRequest.interruptionSource
	fields["interruptionExpected"] = pendingRequest.interruptionExpected
	fields["mistle.turn.interruption_source"] = pendingRequest.interruptionSource
	fields["mistle.turn.interruption_expected"] = pendingRequest.interruptionExpected
	emitCodexProxyLog("codex_proxy.turn.interrupt_request_failed", fields)
}

func observeCodexCompactionRequestFailed(pendingRequest codexPendingRequest, errorValue any) {
	if pendingRequest.threadID == "" {
		return
	}
	fields := codexCompactionLogFields(
		pendingRequest.deliveryContext,
		pendingRequest.threadID,
		"",
		codexCompactionTriggerOrUnknown(pendingRequest.compactionTrigger),
	)
	fields["outcome"] = "failed"
	fields["reason"] = codexErrorMessageOrDefault(errorValue, "rpc_error")
	fields["durationMs"] = time.Since(pendingRequest.startedAt).Milliseconds()
	fields["compactionState"] = "requested"
	fields["mistle.thread.compaction_state"] = "requested"
	emitCodexProxyLog("codex.thread.compaction_request_failed", fields)
}

func observeCodexCompactionRequestAccepted(pendingRequest codexPendingRequest, relayState *codexRelayState) {
	if pendingRequest.threadID == "" {
		return
	}
	trigger := codexCompactionTriggerOrUnknown(pendingRequest.compactionTrigger)
	fields := codexCompactionLogFields(pendingRequest.deliveryContext, pendingRequest.threadID, "", trigger)
	fields["outcome"] = "accepted"
	fields["reason"] = ""
	fields["durationMs"] = time.Since(pendingRequest.startedAt).Milliseconds()
	fields["compactionState"] = "requested"
	fields["mistle.thread.compaction_state"] = "requested"
	emitCodexProxyLog("codex.thread.compaction_requested", fields)
	relayState.mutex.Lock()
	if relayState.pendingCompactions == nil {
		relayState.pendingCompactions = map[string]codexPendingCompaction{}
	}
	relayState.pendingCompactions[pendingRequest.threadID] = codexPendingCompaction{
		threadID:        pendingRequest.threadID,
		trigger:         trigger,
		deliveryContext: pendingRequest.deliveryContext,
		startedAt:       pendingRequest.startedAt,
	}
	relayState.mutex.Unlock()
}

func observeCodexTurnFirstItem(payload map[string]any, relayState *codexRelayState) {
	params, _ := payload["params"].(map[string]any)
	item, _ := params["item"].(map[string]any)
	itemType, _ := item["type"].(string)
	turn, _ := params["turn"].(map[string]any)
	turnID, _ := turn["id"].(string)
	if turnID == "" {
		turnID, _ = params["turnId"].(string)
	}
	if turnID == "" {
		return
	}
	recordedFirstItem := false
	relayState.mutex.Lock()
	activeTurn, ok := relayState.activeTurns[turnID]
	if ok && !activeTurn.firstItem {
		activeTurn.firstItem = true
		activeTurn.firstItemType = itemType
		relayState.activeTurns[turnID] = activeTurn
		recordedFirstItem = true
	}
	relayState.mutex.Unlock()
	if !recordedFirstItem || activeTurn.deliveryContext == nil {
		return
	}
	fields := codexActiveTurnLogFields(activeTurn)
	fields["outcome"] = "started"
	if itemType != "" {
		fields["reason"] = itemType
	}
	fields["durationMs"] = time.Since(activeTurn.startedAt).Milliseconds()
	emitCodexProxyLog("codex_proxy.turn.first_item", fields)
}

func observeCodexCompactionNotification(payload map[string]any, relayState *codexRelayState, event string, state string) {
	params, _ := payload["params"].(map[string]any)
	item, _ := params["item"].(map[string]any)
	itemType, _ := item["type"].(string)
	if itemType != "contextCompaction" {
		return
	}
	itemID, _ := item["id"].(string)
	turn, _ := params["turn"].(map[string]any)
	turnID, _ := turn["id"].(string)
	if turnID == "" {
		turnID, _ = params["turnId"].(string)
	}
	threadID, _ := params["threadId"].(string)
	relayState.mutex.Lock()
	activeTurn, ok := relayState.activeTurns[turnID]
	var activeCompaction codexActiveCompaction
	compactionMatched := false
	if event == "codex.thread.compaction_completed" {
		if itemID != "" {
			activeCompaction, compactionMatched = relayState.activeCompactions[itemID]
			if compactionMatched {
				delete(relayState.activeCompactions, itemID)
			}
		}
	} else if ok && itemID != "" {
		if threadID == "" {
			threadID = activeTurn.threadID
		}
		trigger := "auto"
		requestedAt := time.Time{}
		if pendingCompaction, exists := relayState.pendingCompactions[threadID]; exists {
			trigger = pendingCompaction.trigger
			requestedAt = pendingCompaction.startedAt
			delete(relayState.pendingCompactions, threadID)
		}
		activeCompaction = codexActiveCompaction{
			itemID:          itemID,
			threadID:        threadID,
			turnID:          turnID,
			trigger:         trigger,
			deliveryContext: activeTurn.deliveryContext,
			startedAt:       time.Now(),
			requestedAt:     requestedAt,
		}
		if relayState.activeCompactions == nil {
			relayState.activeCompactions = map[string]codexActiveCompaction{}
		}
		relayState.activeCompactions[itemID] = activeCompaction
		compactionMatched = true
	}
	relayState.mutex.Unlock()
	if compactionMatched {
		fields := codexActiveCompactionLogFields(activeCompaction)
		fields["outcome"] = codexCompactionOutcomeForState(state)
		fields["reason"] = codexCompactionReasonForState(state)
		fields["durationMs"] = codexCompactionDurationMillis(activeCompaction)
		fields["compactionState"] = state
		fields["mistle.thread.compaction_state"] = state
		emitCodexProxyLog(event, fields)
		return
	}
	if ok {
		threadID = activeTurn.threadID
	}
	if !ok || activeTurn.deliveryContext == nil {
		return
	}
	fields := codexActiveTurnLogFields(activeTurn)
	fields["threadId"] = threadID
	fields["providerConversationId"] = threadID
	fields["compactionState"] = state
	fields["mistle.thread.compaction_state"] = state
	fields["mistle.thread.compaction_trigger"] = "context_compaction"
	emitCodexProxyLog(event, fields)
}

func finalizeCodexActiveTurnsForTransportOutcome(relayState *codexRelayState, reason string) {
	relayState.mutex.Lock()
	activeTurns := make([]codexActiveTurn, 0, len(relayState.activeTurns))
	for turnID, activeTurn := range relayState.activeTurns {
		activeTurns = append(activeTurns, activeTurn)
		delete(relayState.activeTurns, turnID)
	}
	pendingCompactions := make([]codexPendingCompaction, 0, len(relayState.pendingCompactions))
	for threadID, pendingCompaction := range relayState.pendingCompactions {
		pendingCompactions = append(pendingCompactions, pendingCompaction)
		delete(relayState.pendingCompactions, threadID)
	}
	activeCompactions := make([]codexActiveCompaction, 0, len(relayState.activeCompactions))
	for itemID, activeCompaction := range relayState.activeCompactions {
		activeCompactions = append(activeCompactions, activeCompaction)
		delete(relayState.activeCompactions, itemID)
	}
	relayState.mutex.Unlock()
	for _, activeTurn := range activeTurns {
		finalizeCodexActiveTurnForTransportOutcome(activeTurn, "reset", reason)
	}
	for _, pendingCompaction := range pendingCompactions {
		finalizeCodexPendingCompactionForTransportOutcome(pendingCompaction, reason)
	}
	for _, activeCompaction := range activeCompactions {
		finalizeCodexActiveCompactionForTransportOutcome(activeCompaction, reason)
	}
}

func finalizeCodexActiveTurnForTransportOutcome(activeTurn codexActiveTurn, outcome string, reason string) {
	if activeTurn.deliveryContext == nil {
		return
	}
	fields := codexActiveTurnLogFields(activeTurn)
	fields["outcome"] = "interrupted"
	fields["reason"] = reason
	fields["durationMs"] = time.Since(activeTurn.startedAt).Milliseconds()
	if activeTurn.interruptionSource == "" {
		expected := false
		activeTurn.interruptionSource = codexInterruptionSourceForTransportReason(reason)
		activeTurn.interruptionExpected = &expected
	}
	applyCodexInterruptionFields(fields, activeTurn)
	emitCodexProxyLog("codex_proxy.turn.interrupted", fields)
	fields["outcome"] = outcome
	if !activeTurn.firstItem {
		fields["reason"] = "started_but_no_output"
	} else {
		fields["reason"] = reason
	}
	emitCodexProxyLog("codex_proxy.turn.transport_ended", fields)
	fields["outcome"] = "stalled"
	fields["reason"] = reason
	emitCodexProxyLog("codex_proxy.turn.stalled", fields)
}

func finalizeCodexPendingCompactionForTransportOutcome(pendingCompaction codexPendingCompaction, reason string) {
	fields := codexCompactionLogFields(pendingCompaction.deliveryContext, pendingCompaction.threadID, "", pendingCompaction.trigger)
	fields["outcome"] = "failed"
	fields["reason"] = reason
	fields["durationMs"] = time.Since(pendingCompaction.startedAt).Milliseconds()
	fields["compactionState"] = "unknown_terminal_outcome"
	fields["mistle.thread.compaction_state"] = "unknown_terminal_outcome"
	emitCodexProxyLog("codex.thread.compaction_unknown_terminal_outcome", fields)
}

func finalizeCodexActiveCompactionForTransportOutcome(activeCompaction codexActiveCompaction, reason string) {
	fields := codexActiveCompactionLogFields(activeCompaction)
	fields["outcome"] = "failed"
	fields["reason"] = reason
	fields["durationMs"] = codexCompactionDurationMillis(activeCompaction)
	fields["compactionState"] = "unknown_terminal_outcome"
	fields["mistle.thread.compaction_state"] = "unknown_terminal_outcome"
	emitCodexProxyLog("codex.thread.compaction_unknown_terminal_outcome", fields)
}

func codexTurnIDFromResponseResult(method string, result map[string]any) string {
	switch method {
	case "turn/start":
		turn, _ := result["turn"].(map[string]any)
		turnID, _ := turn["id"].(string)
		return turnID
	case "turn/steer":
		turnID, _ := result["turnId"].(string)
		return turnID
	default:
		return ""
	}
}

func codexTurnRequestKind(method string) string {
	switch method {
	case "turn/steer":
		return "turn_steer"
	default:
		return "turn_start"
	}
}

func codexTurnOutcomeForStatus(status string) string {
	switch status {
	case "completed", "success", "succeeded":
		return "completed"
	case "interrupted", "cancelled", "canceled":
		return "interrupted"
	default:
		return "failed"
	}
}

func codexTurnOutcomeAndReason(status string, activeTurn codexActiveTurn) (string, string) {
	switch status {
	case "completed", "success", "succeeded":
		return "completed", ""
	case "failed":
		if activeTurn.firstItem {
			return "failed", "failed_after_output"
		}
		return "failed", "failed_before_first_item"
	case "interrupted", "cancelled", "canceled":
		return "interrupted", ""
	default:
		return "failed", "unknown_turn_status"
	}
}

func codexResponseHasTurnID(method string, result map[string]any) bool {
	switch method {
	case "turn/start":
		turn, _ := result["turn"].(map[string]any)
		turnID, _ := turn["id"].(string)
		return turnID != ""
	case "turn/steer":
		turnID, _ := result["turnId"].(string)
		return turnID != ""
	default:
		return false
	}
}

func codexErrorMessage(value any) string {
	errorObject, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	message, _ := errorObject["message"].(string)
	return message
}

func codexErrorMessageOrDefault(value any, defaultValue string) string {
	if message := codexErrorMessage(value); message != "" {
		return message
	}
	return defaultValue
}

func codexInterruptionSourceForClientKind(clientKind codexProxyClientKind) string {
	switch clientKind {
	case codexProxyClientKindMistleAgentClient:
		return "trigger_interrupt"
	case codexProxyClientKindOther:
		return "manual_user_interrupt"
	default:
		return "unknown_interrupt"
	}
}

func codexInterruptionExpectedForSource(source string) bool {
	switch source {
	case "manual_user_interrupt", "trigger_interrupt", "control_plane_interrupt":
		return true
	default:
		return false
	}
}

func applyCodexInterruptionFields(fields map[string]any, activeTurn codexActiveTurn) {
	source := activeTurn.interruptionSource
	if source == "" {
		source = "unknown_interrupt"
	}
	expected := false
	if activeTurn.interruptionExpected != nil {
		expected = *activeTurn.interruptionExpected
	}
	fields["interruptionSource"] = source
	fields["interruptionExpected"] = expected
	fields["mistle.turn.interruption_source"] = source
	fields["mistle.turn.interruption_expected"] = expected
}

func codexInterruptionSourceForTransportReason(reason string) string {
	switch reason {
	case "client_close", "client_terminated", "client_stream_ended", "client_socket_error", "client_write_error":
		return "proxy_disconnect"
	default:
		return "session_reset"
	}
}

func codexCompactionTriggerOrUnknown(trigger string) string {
	if trigger == "" {
		return "unknown"
	}
	return trigger
}

func codexCompactionOutcomeForState(state string) string {
	switch state {
	case "started":
		return "started"
	case "completed":
		return "compacted"
	default:
		return "failed"
	}
}

func codexCompactionReasonForState(state string) string {
	if state == "started" {
		return "started"
	}
	return ""
}

func codexDeliveryContextLogFields(deliveryContext *codexDeliveryContextPayload) map[string]any {
	if deliveryContext == nil {
		return map[string]any{
			"traceId":           "unknown",
			"otel.trace_id":     "unknown",
			"deliveryTaskId":    "",
			"triggerRunId":      "",
			"conversationId":    "",
			"sandboxInstanceId": "",
			"source":            "",
		}
	}
	fields := map[string]any{
		"traceId":           codexTraceIDFromTraceparent(deliveryContext.Traceparent),
		"otel.trace_id":     codexTraceIDFromTraceparent(deliveryContext.Traceparent),
		"traceparent":       deliveryContext.Traceparent,
		"deliveryTaskId":    deliveryContext.DeliveryTaskID,
		"triggerRunId":      deliveryContext.TriggerRunID,
		"conversationId":    deliveryContext.ConversationID,
		"sandboxInstanceId": deliveryContext.SandboxInstanceID,
		"source":            string(deliveryContext.Source),
	}
	if deliveryContext.WebhookEventID != nil {
		fields["webhookEventId"] = *deliveryContext.WebhookEventID
	}
	if deliveryContext.ScheduledActionID != nil {
		fields["scheduledActionId"] = *deliveryContext.ScheduledActionID
	}
	if deliveryContext.ExternalDeliveryID != nil {
		fields["externalDeliveryId"] = *deliveryContext.ExternalDeliveryID
	}
	if deliveryContext.RouteID != nil {
		fields["routeId"] = *deliveryContext.RouteID
	}
	if deliveryContext.Tracestate != nil {
		fields["tracestate"] = *deliveryContext.Tracestate
	}
	if deliveryContext.Baggage != nil {
		fields["baggage"] = *deliveryContext.Baggage
	}
	return fields
}

func codexCompactionLogFields(deliveryContext *codexDeliveryContextPayload, threadID string, turnID string, trigger string) map[string]any {
	fields := codexDeliveryContextLogFields(deliveryContext)
	fields["threadId"] = threadID
	fields["turnId"] = turnID
	fields["providerConversationId"] = threadID
	fields["providerExecutionId"] = turnID
	fields["compactionTrigger"] = codexCompactionTriggerOrUnknown(trigger)
	fields["mistle.thread.compaction_trigger"] = codexCompactionTriggerOrUnknown(trigger)
	return fields
}

func codexActiveCompactionLogFields(activeCompaction codexActiveCompaction) map[string]any {
	return codexCompactionLogFields(
		activeCompaction.deliveryContext,
		activeCompaction.threadID,
		activeCompaction.turnID,
		activeCompaction.trigger,
	)
}

func codexCompactionDurationMillis(activeCompaction codexActiveCompaction) int64 {
	startedAt := activeCompaction.startedAt
	if !activeCompaction.requestedAt.IsZero() {
		startedAt = activeCompaction.requestedAt
	}
	return time.Since(startedAt).Milliseconds()
}

func codexActiveTurnLogFields(activeTurn codexActiveTurn) map[string]any {
	fields := codexDeliveryContextLogFields(activeTurn.deliveryContext)
	fields["threadId"] = activeTurn.threadID
	fields["turnId"] = activeTurn.turnID
	fields["providerConversationId"] = activeTurn.threadID
	fields["providerExecutionId"] = activeTurn.turnID
	fields["mistle.turn.id"] = activeTurn.turnID
	fields["mistle.turn.request_kind"] = activeTurn.requestKind
	return fields
}

func codexTraceIDFromTraceparent(traceparent string) string {
	parts := strings.Split(traceparent, "-")
	if len(parts) >= 2 && parts[1] != "" {
		return parts[1]
	}
	return "unknown"
}

func emitCodexProxyLog(event string, fields map[string]any) {
	if codexProxyLogOutput == nil {
		return
	}
	payload := map[string]any{
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"level":     "info",
		"event":     event,
		"component": "CodexProxy",
	}
	for key, value := range fields {
		payload[key] = value
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		fmt.Fprintf(codexProxyLogOutput, `{"event":"codex_proxy_log_encode_failed","error":%q}`+"\n", err.Error())
		return
	}
	fmt.Fprintln(codexProxyLogOutput, string(encoded))
}

func writeCodexRetentionError(ctx context.Context, connection *websocket.Conn, responsePayload []byte) error {
	serialized, err := codexRetentionErrorPayload(responsePayload)
	if err != nil {
		return err
	}
	return connection.Write(ctx, websocket.MessageText, serialized)
}

func codexRetentionErrorPayload(responsePayload []byte) ([]byte, error) {
	var response map[string]any
	if err := json.Unmarshal(responsePayload, &response); err != nil {
		return nil, err
	}
	errorPayload := map[string]any{
		"id": response["id"],
		"error": map[string]any{
			"code":    -32000,
			"message": "sandboxd failed to retain Codex thread subscription for background execution",
		},
	}
	serialized, err := json.Marshal(errorPayload)
	if err != nil {
		return nil, err
	}
	return serialized, nil
}
