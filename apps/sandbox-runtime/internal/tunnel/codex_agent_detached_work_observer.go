package tunnel

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/httpclient"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

const (
	codexAgentRuntimeKey               = "codex-app-server"
	codexDetachedWorkProtocolFamily    = "codex-json-rpc"
	codexInitializeMethod              = "initialize"
	codexInitializedMethod             = "initialized"
	codexThreadReadMethod              = "thread/read"
	codexTurnCompletedNotification     = "turn/completed"
	codexTurnStartMethod               = "turn/start"
	codexDetachedWorkRenewInterval     = 10 * time.Second
	codexInspectorRequestTimeout       = 5 * time.Second
	codexInitializeRequestID           = "mistle-sandboxd-initialize"
	codexThreadReadRequestID           = "mistle-sandboxd-thread-read"
	codexObserverClientInfoName        = "mistle_sandboxd"
	codexObserverClientInfoTitle       = "Mistle Sandbox Runtime"
	codexObserverClientInfoVersion     = "0.1.0"
	detachedWorkLeaseIDPrefixAgentTurn = "agent_turn:"
)

func supportsCodexAgentDetachedWorkObserver(runtimeKey string) bool {
	return runtimeKey == codexAgentRuntimeKey
}

type codexPendingTurnStart struct {
	threadID string
}

type codexTurnTracker struct {
	cancel context.CancelFunc
}

type codexAgentDetachedWorkObserver struct {
	ctx              context.Context
	httpClient       *http.Client
	renewInterval    time.Duration
	agentEndpointURL string

	mutex                    sync.Mutex
	tunnelConn               *websocket.Conn
	pendingTurnStartsByReqID map[string]codexPendingTurnStart
	turnTrackersByTurnID     map[string]codexTurnTracker
}

func newCodexAgentDetachedWorkObserver(
	ctx context.Context,
	agentEndpoint *resolvedAgentEndpoint,
) agentDetachedWorkObserver {
	return &codexAgentDetachedWorkObserver{
		ctx:                      ctx,
		httpClient:               httpclient.NewDirectClient(http.DefaultClient),
		renewInterval:            codexDetachedWorkRenewInterval,
		agentEndpointURL:         agentEndpoint.TransportURL,
		pendingTurnStartsByReqID: make(map[string]codexPendingTurnStart),
		turnTrackersByTurnID:     make(map[string]codexTurnTracker),
	}
}

func (observer *codexAgentDetachedWorkObserver) SetTunnelConn(tunnelConn *websocket.Conn) {
	observer.mutex.Lock()
	defer observer.mutex.Unlock()

	observer.tunnelConn = tunnelConn
}

func (observer *codexAgentDetachedWorkObserver) ObserveClientMessage(
	messageType websocket.MessageType,
	payload []byte,
) {
	if messageType != websocket.MessageText {
		return
	}

	requestID, threadID, ok := parseCodexTurnStartRequest(payload)
	if !ok {
		return
	}

	observer.mutex.Lock()
	defer observer.mutex.Unlock()

	observer.pendingTurnStartsByReqID[requestID] = codexPendingTurnStart{
		threadID: threadID,
	}
}

func (observer *codexAgentDetachedWorkObserver) ObserveAgentMessage(
	messageType websocket.MessageType,
	payload []byte,
) {
	if messageType != websocket.MessageText {
		return
	}

	turnID, ok := parseCodexTurnCompletedNotification(payload)
	if ok {
		observer.stopTracker(turnID)
		return
	}

	requestID, turnID, ok := parseCodexTurnStartResponse(payload)
	if !ok {
		return
	}

	observer.mutex.Lock()
	pendingTurnStart, exists := observer.pendingTurnStartsByReqID[requestID]
	if exists {
		delete(observer.pendingTurnStartsByReqID, requestID)
	}
	observer.mutex.Unlock()
	if !exists {
		return
	}

	observer.startTracker(pendingTurnStart.threadID, turnID)
}

func (observer *codexAgentDetachedWorkObserver) startTracker(threadID string, turnID string) {
	observer.mutex.Lock()
	if _, exists := observer.turnTrackersByTurnID[turnID]; exists {
		observer.mutex.Unlock()
		return
	}

	trackerContext, cancel := context.WithCancel(observer.ctx)
	observer.turnTrackersByTurnID[turnID] = codexTurnTracker{
		cancel: cancel,
	}
	observer.mutex.Unlock()

	observer.writeDetachedWorkLeaseOpen(turnID)

	go observer.runTurnTracker(trackerContext, threadID, turnID)
}

func (observer *codexAgentDetachedWorkObserver) stopTracker(turnID string) {
	observer.mutex.Lock()
	tracker, exists := observer.turnTrackersByTurnID[turnID]
	if exists {
		delete(observer.turnTrackersByTurnID, turnID)
	}
	observer.mutex.Unlock()

	if exists {
		tracker.cancel()
	}
}

func (observer *codexAgentDetachedWorkObserver) runTurnTracker(
	ctx context.Context,
	threadID string,
	turnID string,
) {
	timer := time.NewTimer(observer.renewInterval)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			inProgress, err := observer.inspectTurnInProgress(ctx, threadID, turnID)
			if err == nil {
				if !inProgress {
					observer.stopTracker(turnID)
					return
				}
				observer.writeDetachedWorkLeaseRenew(turnID)
			}

			timer.Reset(observer.renewInterval)
		}
	}
}

func (observer *codexAgentDetachedWorkObserver) writeDetachedWorkLeaseOpen(turnID string) {
	tunnelConn := observer.currentTunnelConn()
	if tunnelConn == nil {
		return
	}

	writeContext, cancel := context.WithTimeout(observer.ctx, codexInspectorRequestTimeout)
	defer cancel()

	_ = writeDetachedWorkLeaseOpen(writeContext, tunnelConn, sessionprotocol.DetachedWorkLeaseOpen{
		Type:                sessionprotocol.MessageTypeDetachedWorkLeaseOpen,
		LeaseID:             buildDetachedWorkLeaseID(turnID),
		Kind:                sessionprotocol.DetachedWorkLeaseKindAgentTurn,
		ProtocolFamily:      codexDetachedWorkProtocolFamily,
		ExternalExecutionID: turnID,
	})
}

func (observer *codexAgentDetachedWorkObserver) writeDetachedWorkLeaseRenew(turnID string) {
	tunnelConn := observer.currentTunnelConn()
	if tunnelConn == nil {
		return
	}

	writeContext, cancel := context.WithTimeout(observer.ctx, codexInspectorRequestTimeout)
	defer cancel()

	_ = writeDetachedWorkLeaseRenew(writeContext, tunnelConn, sessionprotocol.DetachedWorkLeaseRenew{
		Type:                sessionprotocol.MessageTypeDetachedWorkLeaseRenew,
		LeaseID:             buildDetachedWorkLeaseID(turnID),
		Kind:                sessionprotocol.DetachedWorkLeaseKindAgentTurn,
		ProtocolFamily:      codexDetachedWorkProtocolFamily,
		ExternalExecutionID: turnID,
	})
}

func (observer *codexAgentDetachedWorkObserver) currentTunnelConn() *websocket.Conn {
	observer.mutex.Lock()
	defer observer.mutex.Unlock()

	return observer.tunnelConn
}

func (observer *codexAgentDetachedWorkObserver) inspectTurnInProgress(
	ctx context.Context,
	threadID string,
	turnID string,
) (bool, error) {
	requestContext, cancel := context.WithTimeout(ctx, codexInspectorRequestTimeout)
	defer cancel()

	conn, _, err := websocket.Dial(requestContext, observer.agentEndpointURL, &websocket.DialOptions{
		HTTPClient: observer.httpClient,
	})
	if err != nil {
		return false, fmt.Errorf("failed to connect codex inspector websocket: %w", err)
	}
	defer conn.CloseNow()

	if err := initializeCodexInspectorSession(requestContext, conn); err != nil {
		return false, err
	}

	responsePayload, err := sendCodexInspectorRequest(
		requestContext,
		conn,
		codexThreadReadRequestID,
		codexThreadReadMethod,
		map[string]any{
			"threadId":     threadID,
			"includeTurns": true,
		},
	)
	if err != nil {
		return false, err
	}

	return parseCodexThreadReadTurnInProgress(responsePayload, turnID)
}

func initializeCodexInspectorSession(
	ctx context.Context,
	conn *websocket.Conn,
) error {
	responsePayload, err := sendCodexInspectorRequest(
		ctx,
		conn,
		codexInitializeRequestID,
		codexInitializeMethod,
		map[string]any{
			"clientInfo": map[string]string{
				"name":    codexObserverClientInfoName,
				"title":   codexObserverClientInfoTitle,
				"version": codexObserverClientInfoVersion,
			},
		},
	)
	if err != nil {
		return err
	}

	if !json.Valid(responsePayload) {
		return fmt.Errorf("codex initialize response did not include a JSON result")
	}

	return sendCodexInspectorNotification(ctx, conn, codexInitializedMethod)
}

func sendCodexInspectorRequest(
	ctx context.Context,
	conn *websocket.Conn,
	requestID string,
	method string,
	params map[string]any,
) ([]byte, error) {
	requestPayload := map[string]any{
		"id":     requestID,
		"method": method,
		"params": params,
	}
	if err := writeCodexInspectorJSON(ctx, conn, requestPayload); err != nil {
		return nil, err
	}

	for {
		messageType, payload, err := conn.Read(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed reading codex inspector response: %w", err)
		}
		if messageType != websocket.MessageText {
			continue
		}

		responseID, resultPayload, responseErr, ok := parseCodexInspectorResponse(payload)
		if !ok || responseID != requestID {
			continue
		}
		if responseErr != nil {
			return nil, responseErr
		}

		return resultPayload, nil
	}
}

func sendCodexInspectorNotification(
	ctx context.Context,
	conn *websocket.Conn,
	method string,
) error {
	return writeCodexInspectorJSON(ctx, conn, map[string]string{
		"method": method,
	})
}

func writeCodexInspectorJSON(
	ctx context.Context,
	conn *websocket.Conn,
	payload any,
) error {
	encodedPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to encode codex inspector payload: %w", err)
	}

	if err := conn.Write(ctx, websocket.MessageText, encodedPayload); err != nil {
		return fmt.Errorf("failed to write codex inspector payload: %w", err)
	}

	return nil
}

func parseCodexInspectorResponse(payload []byte) (string, []byte, error, bool) {
	var response struct {
		ID     json.RawMessage `json:"id"`
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(payload, &response); err != nil {
		return "", nil, nil, false
	}

	responseID, ok := parseJSONRPCID(response.ID)
	if !ok {
		return "", nil, nil, false
	}
	if response.Error != nil {
		return responseID, nil, fmt.Errorf(
			"codex inspector request failed (%d): %s",
			response.Error.Code,
			response.Error.Message,
		), true
	}

	return responseID, response.Result, nil, true
}

func parseCodexTurnStartRequest(payload []byte) (string, string, bool) {
	var request struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
		Params struct {
			ThreadID string `json:"threadId"`
		} `json:"params"`
	}
	if err := json.Unmarshal(payload, &request); err != nil {
		return "", "", false
	}
	if request.Method != codexTurnStartMethod {
		return "", "", false
	}

	requestID, ok := parseJSONRPCID(request.ID)
	if !ok {
		return "", "", false
	}

	threadID := strings.TrimSpace(request.Params.ThreadID)
	if threadID == "" {
		return "", "", false
	}

	return requestID, threadID, true
}

func parseCodexTurnStartResponse(payload []byte) (string, string, bool) {
	var response struct {
		ID     json.RawMessage `json:"id"`
		Result struct {
			Turn struct {
				ID string `json:"id"`
			} `json:"turn"`
		} `json:"result"`
	}
	if err := json.Unmarshal(payload, &response); err != nil {
		return "", "", false
	}

	requestID, ok := parseJSONRPCID(response.ID)
	if !ok {
		return "", "", false
	}

	turnID := strings.TrimSpace(response.Result.Turn.ID)
	if turnID == "" {
		return "", "", false
	}

	return requestID, turnID, true
}

func parseCodexTurnCompletedNotification(payload []byte) (string, bool) {
	var notification struct {
		Method string `json:"method"`
		Params struct {
			Turn struct {
				ID string `json:"id"`
			} `json:"turn"`
		} `json:"params"`
	}
	if err := json.Unmarshal(payload, &notification); err != nil {
		return "", false
	}
	if notification.Method != codexTurnCompletedNotification {
		return "", false
	}

	turnID := strings.TrimSpace(notification.Params.Turn.ID)
	if turnID == "" {
		return "", false
	}

	return turnID, true
}

func parseCodexThreadReadTurnInProgress(payload []byte, turnID string) (bool, error) {
	var response struct {
		Thread struct {
			Turns []struct {
				ID     string `json:"id"`
				Status string `json:"status"`
			} `json:"turns"`
		} `json:"thread"`
	}
	if err := json.Unmarshal(payload, &response); err != nil {
		return false, fmt.Errorf("failed to parse codex thread/read response: %w", err)
	}

	for _, turn := range response.Thread.Turns {
		if strings.TrimSpace(turn.ID) != turnID {
			continue
		}

		return turn.Status == "inProgress", nil
	}

	return false, nil
}

func parseJSONRPCID(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}

	var stringValue string
	if err := json.Unmarshal(raw, &stringValue); err == nil {
		stringValue = strings.TrimSpace(stringValue)
		return stringValue, stringValue != ""
	}

	var numberValue json.Number
	if err := json.Unmarshal(raw, &numberValue); err == nil {
		numberText := strings.TrimSpace(numberValue.String())
		return numberText, numberText != ""
	}

	return "", false
}

func buildDetachedWorkLeaseID(externalExecutionID string) string {
	return detachedWorkLeaseIDPrefixAgentTurn + externalExecutionID
}
