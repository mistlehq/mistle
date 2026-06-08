package piproxy

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/mistle/sandboxd/idempotency"
)

type SharedIdempotencyStore struct {
	mutex sync.Mutex
	store *idempotency.Store
}

type Idempotency struct {
	Key                string                         `json:"key"`
	Operation          IdempotencyOperation           `json:"operation"`
	RequestFingerprint idempotency.RequestFingerprint `json:"requestFingerprint"`
}

type IdempotencyOperation string

const (
	IdempotencyOperationCreateConversation IdempotencyOperation = "createConversation"
	IdempotencyOperationSubmitPayload      IdempotencyOperation = "submitPayload"
)

type StoredResponse struct {
	Payload map[string]any `json:"payload"`
}

type startedOperation struct {
	idempotency Idempotency
	operation   idempotency.IdempotencyOperation
	method      string
}

type idempotencyActionKind string

const (
	idempotencyActionDisabled idempotencyActionKind = "disabled"
	idempotencyActionForward  idempotencyActionKind = "forward"
	idempotencyActionReplay   idempotencyActionKind = "replay"
	idempotencyActionReject   idempotencyActionKind = "reject"
)

type idempotencyAction struct {
	kind    idempotencyActionKind
	started *startedOperation
	replay  *StoredResponse
	message string
}

func NewSharedIdempotencyStore(store *idempotency.Store) *SharedIdempotencyStore {
	return &SharedIdempotencyStore{store: store}
}

func prepareIdempotency(request jsonRPCRequest, store *SharedIdempotencyStore) idempotencyAction {
	if len(request.Idempotency) == 0 || bytes.Equal(bytes.TrimSpace(request.Idempotency), []byte("null")) {
		return idempotencyAction{kind: idempotencyActionDisabled}
	}
	var requestIdempotency Idempotency
	if err := decodeStrictPiIdempotency(request.Idempotency, &requestIdempotency); err != nil {
		return idempotencyAction{kind: idempotencyActionReject, message: fmt.Sprintf("Pi idempotency envelope is invalid: %v", err)}
	}
	operation, rejectMessage := idempotencyOperationForPiMethod(requestIdempotency.Operation, request.Method)
	if rejectMessage != "" {
		return idempotencyAction{kind: idempotencyActionReject, message: rejectMessage}
	}
	if store == nil {
		return idempotencyAction{kind: idempotencyActionReject, message: "Pi idempotency store is not configured."}
	}
	store.mutex.Lock()
	defer store.mutex.Unlock()

	record, err := store.store.GetByKey(idempotency.AgentRuntimePi, operation, requestIdempotency.Key)
	if err != nil {
		var missing idempotency.MissingRecordError
		if !errors.As(err, &missing) {
			return idempotencyAction{kind: idempotencyActionReject, message: err.Error()}
		}
		record, err = store.store.StartOperation(idempotency.StartOperation{
			Key:                requestIdempotency.Key,
			RuntimeID:          idempotency.AgentRuntimePi,
			Operation:          operation,
			RequestFingerprint: requestIdempotency.RequestFingerprint,
			Now:                nowTimestamp(),
		})
		if err != nil {
			return idempotencyAction{kind: idempotencyActionReject, message: err.Error()}
		}
		if record.Status != idempotency.IdempotencyRecordStarted {
			return idempotencyAction{kind: idempotencyActionReject, message: fmt.Sprintf("Pi idempotency key %q did not start in started status.", record.Key)}
		}
		return idempotencyAction{kind: idempotencyActionForward, started: &startedOperation{
			idempotency: requestIdempotency,
			operation:   operation,
			method:      request.Method,
		}}
	}

	outcome, err := record.ClassifyRepeatedRequest(requestIdempotency.RequestFingerprint)
	if err != nil {
		return idempotencyAction{kind: idempotencyActionReject, message: err.Error()}
	}
	if outcome != idempotency.RepeatedRequestCompleted {
		return idempotencyAction{kind: idempotencyActionReject, message: fmt.Sprintf("Pi idempotency key %q has unresolved status %s.", record.Key, record.Status)}
	}
	response, err := storedResponseFromRecord(record)
	if err != nil {
		return idempotencyAction{kind: idempotencyActionReject, message: fmt.Sprintf("Pi idempotency response is invalid: %v", err)}
	}
	return idempotencyAction{kind: idempotencyActionReplay, replay: &response}
}

func completeIdempotency(store *SharedIdempotencyStore, started startedOperation, response StoredResponse) error {
	providerConversationID := providerConversationIDFromResponse(started.method, response.Payload)
	store.mutex.Lock()
	defer store.mutex.Unlock()
	_, err := store.store.MarkCompleted(idempotency.AgentRuntimePi, started.operation, started.idempotency.Key, idempotency.CompleteOperation{
		RequestFingerprint:     started.idempotency.RequestFingerprint,
		ProviderConversationID: providerConversationID,
		ProviderExecutionID:    nil,
		RuntimeArtifactHint:    map[string]any{"method": started.method},
		Response:               response,
		Now:                    nowTimestamp(),
	})
	return err
}

func deleteStartedIdempotency(store *SharedIdempotencyStore, started startedOperation) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	return store.store.DeleteStarted(
		idempotency.AgentRuntimePi,
		started.operation,
		started.idempotency.Key,
		started.idempotency.RequestFingerprint,
	)
}

func idempotencyOperationForPiMethod(operation IdempotencyOperation, method string) (idempotency.IdempotencyOperation, string) {
	switch operation {
	case IdempotencyOperationCreateConversation:
		if method != "pi/createConversation" {
			return "", "Pi createConversation idempotency requires pi/createConversation."
		}
		return idempotency.IdempotencyOperationCreateConversation, ""
	case IdempotencyOperationSubmitPayload:
		if method != "pi/prompt" && method != "pi/steer" && method != "pi/followUp" {
			return "", "Pi submitPayload idempotency requires pi/prompt, pi/steer, or pi/followUp."
		}
		return idempotency.IdempotencyOperationSubmitPayload, ""
	default:
		return "", "Pi idempotency operation is not supported."
	}
}

func providerConversationIDFromResponse(method string, payload map[string]any) *string {
	result, ok := payload["result"].(map[string]any)
	if !ok {
		return nil
	}
	switch method {
	case "pi/createConversation":
		if providerConversationID, ok := result["providerConversationId"].(string); ok {
			return &providerConversationID
		}
	case "pi/prompt", "pi/steer", "pi/followUp":
		if sessionFile, ok := result["sessionFile"].(string); ok {
			return &sessionFile
		}
	}
	return nil
}

func storedResponseFromRecord(record idempotency.IdempotencyRecord) (StoredResponse, error) {
	serialized, err := json.Marshal(record.Response)
	if err != nil {
		return StoredResponse{}, err
	}
	var response StoredResponse
	if err := json.Unmarshal(serialized, &response); err != nil {
		return StoredResponse{}, err
	}
	return response, nil
}

func nowTimestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
