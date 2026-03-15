package tunnel

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

const (
	codexAgentRuntimeKey                   = "codex-app-server"
	codexExecutionLeaseKind                = "agent_execution"
	codexExecutionLeaseSource              = "codex"
	defaultCodexExecutionLeasePollInterval = 10 * time.Second
)

type codexExecutionLeaseObserverInput struct {
	Context         context.Context
	TransportURL    string
	ExecutionLeases *executionLeaseEngine
	PollInterval    time.Duration
}

type codexExecutionLeaseObserver struct {
	context         context.Context
	transportURL    string
	executionLeases *executionLeaseEngine
	pollInterval    time.Duration

	mu                 sync.Mutex
	pendingRequests    map[string]codexPendingExecutionRequest
	observedExecutions map[string]codexObservedExecution
}

type codexPendingExecutionRequest struct {
	Method   string
	ThreadID string
}

type codexObservedExecution struct {
	lease    sessionprotocol.ExecutionLease
	threadID string
	turnID   string
}

type codexExecutionState string

const (
	codexExecutionStateActive   codexExecutionState = "active"
	codexExecutionStateTerminal codexExecutionState = "terminal"
	codexExecutionStateMissing  codexExecutionState = "missing"
)

type codexJSONRPCMethodError struct {
	Method  string
	Code    int
	Message string
}

func (err codexJSONRPCMethodError) Error() string {
	return fmt.Sprintf("codex JSON-RPC request %q failed (%d): %s", err.Method, err.Code, err.Message)
}

func newCodexExecutionLeaseObserver(
	input codexExecutionLeaseObserverInput,
) *codexExecutionLeaseObserver {
	return &codexExecutionLeaseObserver{
		context:            input.Context,
		transportURL:       input.TransportURL,
		executionLeases:    input.ExecutionLeases,
		pollInterval:       input.PollInterval,
		pendingRequests:    make(map[string]codexPendingExecutionRequest),
		observedExecutions: make(map[string]codexObservedExecution),
	}
}

func (observer *codexExecutionLeaseObserver) ObserveClientMessage(payload []byte) {
	request, ok := parseCodexJSONRPCRequest(payload)
	if !ok {
		return
	}

	threadID, ok := extractCodexTurnRequestThreadID(request.Method, request.Params)
	if !ok {
		return
	}

	observer.mu.Lock()
	defer observer.mu.Unlock()

	observer.pendingRequests[request.ID] = codexPendingExecutionRequest{
		Method:   request.Method,
		ThreadID: threadID,
	}
}

func (observer *codexExecutionLeaseObserver) ObserveAgentMessage(payload []byte) {
	response, ok := parseCodexJSONRPCResponse(payload)
	if !ok {
		return
	}

	observer.mu.Lock()
	defer observer.mu.Unlock()

	pendingRequest, exists := observer.pendingRequests[response.ID]
	if !exists {
		return
	}
	delete(observer.pendingRequests, response.ID)

	if response.Error != nil {
		return
	}

	turnID, ok := extractCodexTurnIDFromResponse(pendingRequest.Method, response.Result)
	if !ok {
		return
	}

	lease := sessionprotocol.ExecutionLease{
		ID:                  newCodexExecutionLeaseID(pendingRequest.ThreadID, turnID),
		Kind:                codexExecutionLeaseKind,
		Source:              codexExecutionLeaseSource,
		ExternalExecutionID: turnID,
		Metadata: map[string]any{
			"threadId": pendingRequest.ThreadID,
		},
	}

	observer.observedExecutions[lease.ID] = codexObservedExecution{
		lease:    lease,
		threadID: pendingRequest.ThreadID,
		turnID:   turnID,
	}
}

func (observer *codexExecutionLeaseObserver) HandleStreamDisconnected() {
	observer.mu.Lock()
	executions := make([]codexObservedExecution, 0, len(observer.observedExecutions))
	for _, execution := range observer.observedExecutions {
		executions = append(executions, execution)
	}
	observer.pendingRequests = make(map[string]codexPendingExecutionRequest)
	observer.observedExecutions = make(map[string]codexObservedExecution)
	observer.mu.Unlock()

	for _, execution := range executions {
		go runCodexExecutionLeaseMonitor(
			observer.context,
			observer.executionLeases,
			observer.transportURL,
			execution,
			observer.pollInterval,
		)
	}
}

func runCodexExecutionLeaseMonitor(
	ctx context.Context,
	executionLeases *executionLeaseEngine,
	transportURL string,
	execution codexObservedExecution,
	pollInterval time.Duration,
) {
	if pollInterval <= 0 {
		pollInterval = defaultCodexExecutionLeasePollInterval
	}
	if ctx.Err() != nil {
		return
	}

	initialState, err := inspectCodexExecutionState(ctx, transportURL, execution.threadID, execution.turnID)
	if err == nil && initialState != codexExecutionStateActive {
		return
	}
	if err := executionLeases.Create(ctx, execution.lease); err != nil {
		var alreadyTracked executionLeaseAlreadyTrackedError
		if errors.As(err, &alreadyTracked) {
			return
		}
		return
	}
	defer executionLeases.Remove(execution.lease.ID)

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			state, inspectErr := inspectCodexExecutionState(ctx, transportURL, execution.threadID, execution.turnID)
			if inspectErr != nil {
				continue
			}
			if state != codexExecutionStateActive {
				return
			}
			if renewErr := executionLeases.Renew(ctx, execution.lease.ID); renewErr != nil {
				continue
			}
		}
	}
}

type codexJSONRPCRequest struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type codexJSONRPCResponse struct {
	ID     string             `json:"id"`
	Result json.RawMessage    `json:"result"`
	Error  *codexJSONRPCError `json:"error"`
}

type codexJSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func parseCodexJSONRPCRequest(payload []byte) (codexJSONRPCRequest, bool) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return codexJSONRPCRequest{}, false
	}
	method, ok := readJSONStringField(envelope, "method")
	if !ok {
		return codexJSONRPCRequest{}, false
	}
	if method != "turn/start" && method != "turn/steer" {
		return codexJSONRPCRequest{}, false
	}
	id, ok := readJSONRPCID(envelope["id"])
	if !ok {
		return codexJSONRPCRequest{}, false
	}

	return codexJSONRPCRequest{
		ID:     id,
		Method: method,
		Params: envelope["params"],
	}, true
}

func parseCodexJSONRPCResponse(payload []byte) (codexJSONRPCResponse, bool) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return codexJSONRPCResponse{}, false
	}
	id, ok := readJSONRPCID(envelope["id"])
	if !ok {
		return codexJSONRPCResponse{}, false
	}

	response := codexJSONRPCResponse{
		ID:     id,
		Result: envelope["result"],
	}
	if rawError, exists := envelope["error"]; exists && len(rawError) > 0 && string(rawError) != "null" {
		var parsedError codexJSONRPCError
		if err := json.Unmarshal(rawError, &parsedError); err != nil {
			return codexJSONRPCResponse{}, false
		}
		response.Error = &parsedError
	}

	return response, true
}

func readJSONStringField(envelope map[string]json.RawMessage, field string) (string, bool) {
	rawValue, exists := envelope[field]
	if !exists {
		return "", false
	}

	var stringValue string
	if err := json.Unmarshal(rawValue, &stringValue); err != nil {
		return "", false
	}

	return stringValue, true
}

func readJSONRPCID(rawValue json.RawMessage) (string, bool) {
	if len(rawValue) == 0 {
		return "", false
	}

	var stringValue string
	if err := json.Unmarshal(rawValue, &stringValue); err == nil {
		if strings.TrimSpace(stringValue) == "" {
			return "", false
		}
		return stringValue, true
	}

	var numberValue float64
	if err := json.Unmarshal(rawValue, &numberValue); err == nil {
		return strconv.FormatFloat(numberValue, 'f', -1, 64), true
	}

	return "", false
}

func extractCodexTurnRequestThreadID(method string, params json.RawMessage) (string, bool) {
	if method != "turn/start" && method != "turn/steer" {
		return "", false
	}

	var payload struct {
		ThreadID string `json:"threadId"`
	}
	if err := json.Unmarshal(params, &payload); err != nil {
		return "", false
	}
	if strings.TrimSpace(payload.ThreadID) == "" {
		return "", false
	}

	return payload.ThreadID, true
}

func extractCodexTurnIDFromResponse(method string, result json.RawMessage) (string, bool) {
	switch method {
	case "turn/start":
		var payload struct {
			Turn struct {
				ID string `json:"id"`
			} `json:"turn"`
		}
		if err := json.Unmarshal(result, &payload); err != nil {
			return "", false
		}
		if strings.TrimSpace(payload.Turn.ID) == "" {
			return "", false
		}
		return payload.Turn.ID, true
	case "turn/steer":
		var payload struct {
			TurnID string `json:"turnId"`
		}
		if err := json.Unmarshal(result, &payload); err != nil {
			return "", false
		}
		if strings.TrimSpace(payload.TurnID) == "" {
			return "", false
		}
		return payload.TurnID, true
	default:
		return "", false
	}
}

func newCodexExecutionLeaseID(threadID string, turnID string) string {
	digest := sha256.Sum256([]byte(threadID + "\x00" + turnID))
	return fmt.Sprintf("sxl_codex_%x", digest[:8])
}

func inspectCodexExecutionState(
	ctx context.Context,
	transportURL string,
	threadID string,
	turnID string,
) (codexExecutionState, error) {
	connection, err := dialAgentEndpoint(ctx, transportURL)
	if err != nil {
		return "", err
	}
	defer connection.CloseNow()

	client := newCodexLeasePollClient(connection)
	if err := client.Initialize(ctx); err != nil {
		return "", err
	}

	turns, err := client.ReadThread(ctx, threadID)
	if err != nil {
		if !isCodexThreadNotLoadedError(err) {
			if isCodexThreadMissingError(err) {
				return codexExecutionStateMissing, nil
			}
			return "", err
		}

		if resumeErr := client.ResumeThread(ctx, threadID); resumeErr != nil {
			if isCodexThreadMissingError(resumeErr) || isCodexThreadResumeNoRolloutError(resumeErr) {
				return codexExecutionStateMissing, nil
			}
			return "", resumeErr
		}

		turns, err = client.ReadThread(ctx, threadID)
		if err != nil {
			if isCodexThreadMissingError(err) {
				return codexExecutionStateMissing, nil
			}
			return "", err
		}
	}

	for _, turn := range turns {
		if turn.ID != turnID {
			continue
		}

		switch turn.Status {
		case "inProgress":
			return codexExecutionStateActive, nil
		case "completed", "interrupted", "failed":
			return codexExecutionStateTerminal, nil
		default:
			return "", fmt.Errorf("unsupported Codex turn status %q", turn.Status)
		}
	}

	return codexExecutionStateMissing, nil
}

type codexLeasePollClient struct {
	connection *websocket.Conn
	nextID     int
}

type codexLeasePollTurn struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func newCodexLeasePollClient(connection *websocket.Conn) *codexLeasePollClient {
	return &codexLeasePollClient{
		connection: connection,
		nextID:     1,
	}
}

func (client *codexLeasePollClient) Initialize(ctx context.Context) error {
	if _, err := client.Call(ctx, "initialize", map[string]any{
		"clientInfo": map[string]string{
			"name":    "mistle_sandbox_runtime",
			"version": "0.1.0",
		},
	}); err != nil {
		return err
	}

	return writeTextJSONMessage(ctx, client.connection, map[string]any{
		"method": "initialized",
		"params": map[string]any{},
	})
}

func (client *codexLeasePollClient) ReadThread(
	ctx context.Context,
	threadID string,
) ([]codexLeasePollTurn, error) {
	result, err := client.Call(ctx, "thread/read", map[string]any{
		"threadId":     threadID,
		"includeTurns": true,
	})
	if err != nil {
		return nil, err
	}

	var payload struct {
		Thread struct {
			Turns []codexLeasePollTurn `json:"turns"`
		} `json:"thread"`
	}
	if err := json.Unmarshal(result, &payload); err != nil {
		return nil, fmt.Errorf("failed to decode Codex thread/read response: %w", err)
	}

	return payload.Thread.Turns, nil
}

func (client *codexLeasePollClient) ResumeThread(ctx context.Context, threadID string) error {
	_, err := client.Call(ctx, "thread/resume", map[string]any{
		"threadId": threadID,
	})
	return err
}

func (client *codexLeasePollClient) Call(
	ctx context.Context,
	method string,
	params map[string]any,
) (json.RawMessage, error) {
	requestID := client.nextID
	client.nextID += 1

	request := map[string]any{
		"id":     requestID,
		"method": method,
	}
	if params != nil {
		request["params"] = params
	}
	if err := writeTextJSONMessage(ctx, client.connection, request); err != nil {
		return nil, err
	}

	for {
		messageType, payload, err := client.connection.Read(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to read Codex JSON-RPC response: %w", err)
		}
		if messageType != websocket.MessageText {
			return nil, fmt.Errorf("unsupported Codex websocket message type %s", messageType.String())
		}

		response, ok := parseCodexJSONRPCResponse(payload)
		if !ok {
			continue
		}
		if response.ID != strconv.Itoa(requestID) {
			continue
		}
		if response.Error != nil {
			return nil, codexJSONRPCMethodError{
				Method:  method,
				Code:    response.Error.Code,
				Message: response.Error.Message,
			}
		}

		return response.Result, nil
	}
}

func isCodexThreadNotLoadedError(err error) bool {
	var requestError codexJSONRPCMethodError
	return errors.As(err, &requestError) &&
		requestError.Method == "thread/read" &&
		requestError.Code == -32600 &&
		strings.HasPrefix(requestError.Message, "thread not loaded:")
}

func isCodexThreadMissingError(err error) bool {
	var requestError codexJSONRPCMethodError
	if !errors.As(err, &requestError) {
		return false
	}
	if requestError.Code != -32600 {
		return false
	}

	if requestError.Method == "thread/read" || requestError.Method == "thread/resume" {
		return strings.HasPrefix(requestError.Message, "invalid thread id:") ||
			strings.HasPrefix(requestError.Message, "thread not found:")
	}

	return false
}

func isCodexThreadResumeNoRolloutError(err error) bool {
	var requestError codexJSONRPCMethodError
	return errors.As(err, &requestError) &&
		requestError.Method == "thread/resume" &&
		requestError.Code == -32600 &&
		strings.HasPrefix(requestError.Message, "no rollout found for thread id ")
}
