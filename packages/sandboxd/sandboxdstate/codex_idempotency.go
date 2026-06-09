package sandboxdstate

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/mistle/sandboxd/idempotency"
)

const codexIdempotencyErrorCode = -32001

type CodexSharedIdempotencyStore struct {
	mutex sync.Mutex
	store *idempotency.Store
}

type codexIdempotency struct {
	Key                string                         `json:"key"`
	Operation          codexIdempotencyOperation      `json:"operation"`
	RequestFingerprint idempotency.RequestFingerprint `json:"requestFingerprint"`
}

type codexIdempotencyOperation string

const (
	codexIdempotencyOperationCreateConversation codexIdempotencyOperation = "createConversation"
	codexIdempotencyOperationSubmitPayload      codexIdempotencyOperation = "submitPayload"
)

type codexStoredResponse struct {
	Payload map[string]any `json:"payload"`
}

type codexStartedOperation struct {
	idempotency codexIdempotency
	operation   idempotency.IdempotencyOperation
	method      string
}

type codexIdempotencyActionKind string

const (
	codexIdempotencyActionDisabled codexIdempotencyActionKind = "disabled"
	codexIdempotencyActionForward  codexIdempotencyActionKind = "forward"
	codexIdempotencyActionReplay   codexIdempotencyActionKind = "replay"
	codexIdempotencyActionReject   codexIdempotencyActionKind = "reject"
)

type codexIdempotencyAction struct {
	kind    codexIdempotencyActionKind
	started *codexStartedOperation
	replay  *codexStoredResponse
	message string
}

func newCodexSharedIdempotencyStore(store *idempotency.Store) *CodexSharedIdempotencyStore {
	return &CodexSharedIdempotencyStore{store: store}
}

func prepareCodexIdempotency(payload map[string]any, store *CodexSharedIdempotencyStore) codexIdempotencyAction {
	rawIdempotency, hasIdempotency := payload["idempotency"]
	if !hasIdempotency {
		return codexIdempotencyAction{kind: codexIdempotencyActionDisabled}
	}
	delete(payload, "idempotency")
	if rawIdempotency == nil {
		return codexIdempotencyAction{kind: codexIdempotencyActionDisabled}
	}
	var requestIdempotency codexIdempotency
	serialized, err := json.Marshal(rawIdempotency)
	if err != nil {
		return codexIdempotencyAction{kind: codexIdempotencyActionReject, message: fmt.Sprintf("Codex idempotency envelope is invalid: %v", err)}
	}
	if bytes.Equal(bytes.TrimSpace(serialized), []byte("null")) {
		return codexIdempotencyAction{kind: codexIdempotencyActionDisabled}
	}
	if err := decodeStrictCodexIdempotency(serialized, &requestIdempotency); err != nil {
		return codexIdempotencyAction{kind: codexIdempotencyActionReject, message: fmt.Sprintf("Codex idempotency envelope is invalid: %v", err)}
	}
	method, ok := payload["method"].(string)
	if !ok || method == "" {
		return codexIdempotencyAction{kind: codexIdempotencyActionReject, message: "Codex proxy idempotency requires a JSON-RPC method."}
	}
	operation, rejectMessage := codexOperationForMethod(requestIdempotency.Operation, method)
	if rejectMessage != "" {
		return codexIdempotencyAction{kind: codexIdempotencyActionReject, message: rejectMessage}
	}
	if store == nil {
		return codexIdempotencyAction{kind: codexIdempotencyActionReject, message: "Codex idempotency store is not configured."}
	}

	store.mutex.Lock()
	defer store.mutex.Unlock()
	record, err := store.store.GetByKey(idempotency.AgentRuntimeCodex, operation, requestIdempotency.Key)
	if err != nil {
		var missing idempotency.MissingRecordError
		if !errors.As(err, &missing) {
			return codexIdempotencyAction{kind: codexIdempotencyActionReject, message: err.Error()}
		}
		record, err = store.store.StartOperation(idempotency.StartOperation{
			Key:                requestIdempotency.Key,
			RuntimeID:          idempotency.AgentRuntimeCodex,
			Operation:          operation,
			RequestFingerprint: requestIdempotency.RequestFingerprint,
			Now:                codexNowTimestamp(),
		})
		if err != nil {
			return codexIdempotencyAction{kind: codexIdempotencyActionReject, message: err.Error()}
		}
		if record.Status != idempotency.IdempotencyRecordStarted {
			return codexIdempotencyAction{kind: codexIdempotencyActionReject, message: fmt.Sprintf("Codex idempotency key %q did not start in started status.", record.Key)}
		}
		return codexIdempotencyAction{kind: codexIdempotencyActionForward, started: &codexStartedOperation{
			idempotency: requestIdempotency,
			operation:   operation,
			method:      method,
		}}
	}

	outcome, err := record.ClassifyRepeatedRequest(requestIdempotency.RequestFingerprint)
	if err != nil {
		return codexIdempotencyAction{kind: codexIdempotencyActionReject, message: err.Error()}
	}
	if outcome != idempotency.RepeatedRequestCompleted {
		return codexIdempotencyAction{kind: codexIdempotencyActionReject, message: fmt.Sprintf("Codex idempotency key %q has unresolved status %s.", record.Key, record.Status)}
	}
	response, err := codexStoredResponseFromRecord(record)
	if err != nil {
		return codexIdempotencyAction{kind: codexIdempotencyActionReject, message: fmt.Sprintf("Codex idempotency response is invalid: %v", err)}
	}
	return codexIdempotencyAction{kind: codexIdempotencyActionReplay, replay: &response}
}

func completeCodexIdempotency(store *CodexSharedIdempotencyStore, started codexStartedOperation, response codexStoredResponse) error {
	providerConversationID, providerExecutionID := providerIDsForCodexResponse(started.method, response.Payload)
	store.mutex.Lock()
	defer store.mutex.Unlock()
	_, err := store.store.MarkCompleted(idempotency.AgentRuntimeCodex, started.operation, started.idempotency.Key, idempotency.CompleteOperation{
		RequestFingerprint:     started.idempotency.RequestFingerprint,
		ProviderConversationID: providerConversationID,
		ProviderExecutionID:    providerExecutionID,
		RuntimeArtifactHint:    map[string]any{"method": started.method},
		Response:               response,
		Now:                    codexNowTimestamp(),
	})
	return err
}

func codexOperationForMethod(operation codexIdempotencyOperation, method string) (idempotency.IdempotencyOperation, string) {
	switch operation {
	case codexIdempotencyOperationCreateConversation:
		if method != "thread/start" {
			return "", "Codex createConversation idempotency requires thread/start."
		}
		return idempotency.IdempotencyOperationCreateConversation, ""
	case codexIdempotencyOperationSubmitPayload:
		if method != "turn/start" && method != "turn/steer" {
			return "", "Codex submitPayload idempotency requires turn/start or turn/steer."
		}
		return idempotency.IdempotencyOperationSubmitPayload, ""
	default:
		return "", "Codex idempotency operation is not supported."
	}
}

func decodeStrictCodexIdempotency(payload []byte, target *codexIdempotency) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func codexStoredResponseFromRecord(record idempotency.IdempotencyRecord) (codexStoredResponse, error) {
	serialized, err := json.Marshal(record.Response)
	if err != nil {
		return codexStoredResponse{}, err
	}
	var response codexStoredResponse
	if err := json.Unmarshal(serialized, &response); err != nil {
		return codexStoredResponse{}, err
	}
	return response, nil
}

func providerIDsForCodexResponse(method string, payload map[string]any) (*string, *string) {
	if payload["error"] != nil {
		return nil, nil
	}
	result, _ := payload["result"].(map[string]any)
	switch method {
	case "thread/start":
		thread, _ := result["thread"].(map[string]any)
		if threadID, ok := thread["id"].(string); ok {
			return &threadID, nil
		}
	case "turn/start":
		turn, _ := result["turn"].(map[string]any)
		threadID, _ := turn["threadId"].(string)
		turnID, _ := turn["id"].(string)
		return emptyStringNil(threadID), emptyStringNil(turnID)
	case "turn/steer":
		threadID, _ := result["threadId"].(string)
		turnID, _ := result["turnId"].(string)
		return emptyStringNil(threadID), emptyStringNil(turnID)
	}
	return nil, nil
}

func emptyStringNil(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func codexNowTimestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
