package opencodeproxy

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/mistle/sandboxd/idempotency"
)

const openCodeProviderExecutionIDPrefix = "opencode-session"
const httpPostMethod = "POST"

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
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

type startedOperation struct {
	idempotency            Idempotency
	messageID              *string
	operation              idempotency.IdempotencyOperation
	providerConversationID *string
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
	status  int
	message string
}

func NewSharedIdempotencyStore(store *idempotency.Store) *SharedIdempotencyStore {
	return &SharedIdempotencyStore{store: store}
}

func prepareIdempotency(proxyRequest *Request, store *SharedIdempotencyStore) idempotencyAction {
	if len(proxyRequest.Idempotency) == 0 || bytes.Equal(bytes.TrimSpace(proxyRequest.Idempotency), []byte("null")) {
		return idempotencyAction{kind: idempotencyActionDisabled}
	}
	var requestIdempotency Idempotency
	if err := decodeStrictOpenCodeIdempotency(proxyRequest.Idempotency, &requestIdempotency); err != nil {
		return idempotencyAction{kind: idempotencyActionReject, status: 400, message: fmt.Sprintf("OpenCode idempotency envelope is invalid: %v", err)}
	}
	switch requestIdempotency.Operation {
	case IdempotencyOperationCreateConversation:
		return prepareCreateConversationIdempotency(proxyRequest, requestIdempotency, store)
	case IdempotencyOperationSubmitPayload:
		return prepareSubmitPayloadIdempotency(proxyRequest, requestIdempotency, store)
	default:
		return idempotencyAction{kind: idempotencyActionReject, status: 400, message: "OpenCode idempotency operation is not supported."}
	}
}

func prepareCreateConversationIdempotency(proxyRequest *Request, requestIdempotency Idempotency, store *SharedIdempotencyStore) idempotencyAction {
	if proxyRequest.Method != httpPostMethod {
		return idempotencyAction{kind: idempotencyActionReject, status: 400, message: "OpenCode createConversation idempotency requires a POST request."}
	}
	if !isCreateSessionPath(proxyRequest.Path) {
		return idempotencyAction{kind: idempotencyActionReject, status: 400, message: "OpenCode createConversation idempotency requires a /session request."}
	}
	if proxyRequest.Body != nil {
		if _, ok := proxyRequest.Body.(map[string]any); !ok {
			return idempotencyAction{kind: idempotencyActionReject, status: 400, message: "OpenCode createConversation idempotency requires a JSON object request body."}
		}
	}
	return prepareStartedIdempotency(requestIdempotency, idempotency.IdempotencyOperationCreateConversation, nil, nil, store, "OpenCode createConversation")
}

func prepareSubmitPayloadIdempotency(proxyRequest *Request, requestIdempotency Idempotency, store *SharedIdempotencyStore) idempotencyAction {
	if proxyRequest.Method != httpPostMethod {
		return idempotencyAction{kind: idempotencyActionReject, status: 400, message: "OpenCode submitPayload idempotency requires a POST request."}
	}
	providerConversationID, ok := parseSubmitSessionID(proxyRequest.Path)
	if !ok {
		return idempotencyAction{kind: idempotencyActionReject, status: 400, message: "OpenCode submitPayload idempotency requires a /session/{sessionId}/message or /session/{sessionId}/prompt_async request."}
	}
	bodyObject, ok := proxyRequest.Body.(map[string]any)
	if !ok {
		return idempotencyAction{kind: idempotencyActionReject, status: 400, message: "OpenCode submitPayload idempotency requires a JSON object request body."}
	}
	messageID := deterministicMessageID(requestIdempotency.Key)
	if existing, exists := bodyObject["messageID"]; exists {
		existingMessageID, ok := existing.(string)
		if !ok {
			return idempotencyAction{kind: idempotencyActionReject, status: 400, message: "OpenCode submitPayload idempotency messageID must be a string when provided."}
		}
		if existingMessageID != messageID {
			return idempotencyAction{kind: idempotencyActionReject, status: 409, message: "OpenCode submitPayload idempotency messageID conflicts with the deterministic idempotency messageID."}
		}
	} else {
		bodyObject["messageID"] = messageID
	}
	return prepareStartedIdempotency(
		requestIdempotency,
		idempotency.IdempotencyOperationSubmitPayload,
		&providerConversationID,
		&messageID,
		store,
		"OpenCode submitPayload",
	)
}

func prepareStartedIdempotency(
	requestIdempotency Idempotency,
	operation idempotency.IdempotencyOperation,
	providerConversationID *string,
	messageID *string,
	store *SharedIdempotencyStore,
	label string,
) idempotencyAction {
	if store == nil {
		return idempotencyAction{kind: idempotencyActionReject, status: 500, message: label + " idempotency store is not configured."}
	}
	store.mutex.Lock()
	defer store.mutex.Unlock()
	record, err := store.store.GetByKey(idempotency.AgentRuntimeOpenCode, operation, requestIdempotency.Key)
	if err != nil {
		var missing idempotency.MissingRecordError
		if !errors.As(err, &missing) {
			return idempotencyAction{kind: idempotencyActionReject, status: 500, message: err.Error()}
		}
		record, err = store.store.StartOperation(idempotency.StartOperation{
			Key:                requestIdempotency.Key,
			RuntimeID:          idempotency.AgentRuntimeOpenCode,
			Operation:          operation,
			RequestFingerprint: requestIdempotency.RequestFingerprint,
			Now:                nowTimestamp(),
		})
		if err != nil {
			return idempotencyAction{kind: idempotencyActionReject, status: storeErrorStatus(err), message: err.Error()}
		}
		if record.Status != idempotency.IdempotencyRecordStarted {
			return idempotencyAction{kind: idempotencyActionReject, status: 500, message: fmt.Sprintf("%s idempotency key %q did not start in started status.", label, record.Key)}
		}
		return idempotencyAction{kind: idempotencyActionForward, started: &startedOperation{
			idempotency:            requestIdempotency,
			messageID:              messageID,
			operation:              operation,
			providerConversationID: providerConversationID,
		}}
	}
	outcome, err := record.ClassifyRepeatedRequest(requestIdempotency.RequestFingerprint)
	if err != nil {
		return idempotencyAction{kind: idempotencyActionReject, status: 409, message: err.Error()}
	}
	if outcome != idempotency.RepeatedRequestCompleted {
		return idempotencyAction{kind: idempotencyActionReject, status: 409, message: fmt.Sprintf("%s idempotency key %q has unresolved status %s.", label, record.Key, record.Status)}
	}
	replay, err := storedResponseFromRecord(record)
	if err != nil {
		return idempotencyAction{kind: idempotencyActionReject, status: 500, message: fmt.Sprintf("%s idempotency response is invalid: %v", label, err)}
	}
	return idempotencyAction{kind: idempotencyActionReplay, replay: &replay}
}

func decodeStrictOpenCodeIdempotency(payload []byte, target *Idempotency) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func completeIdempotency(store *SharedIdempotencyStore, started startedOperation, response StoredResponse) error {
	providerConversationID := started.providerConversationID
	if started.operation == idempotency.IdempotencyOperationCreateConversation {
		extractedID, err := extractCreatedSessionID(response)
		if err != nil {
			return err
		}
		if extractedID != nil {
			providerConversationID = extractedID
		}
	}
	var providerExecutionID *string
	if started.operation == idempotency.IdempotencyOperationSubmitPayload && providerConversationID != nil {
		value := openCodeProviderExecutionIDPrefix + ":" + *providerConversationID
		providerExecutionID = &value
	}
	var runtimeArtifactHint any
	if started.messageID != nil {
		runtimeArtifactHint = map[string]any{"messageId": *started.messageID}
	}
	store.mutex.Lock()
	defer store.mutex.Unlock()
	_, err := store.store.MarkCompleted(idempotency.AgentRuntimeOpenCode, started.operation, started.idempotency.Key, idempotency.CompleteOperation{
		RequestFingerprint:     started.idempotency.RequestFingerprint,
		ProviderConversationID: providerConversationID,
		ProviderExecutionID:    providerExecutionID,
		RuntimeArtifactHint:    runtimeArtifactHint,
		Response:               response,
		Now:                    nowTimestamp(),
	})
	return err
}

func deleteStartedIdempotency(store *SharedIdempotencyStore, started startedOperation) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	return store.store.DeleteStarted(
		idempotency.AgentRuntimeOpenCode,
		started.operation,
		started.idempotency.Key,
		started.idempotency.RequestFingerprint,
	)
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

func isCreateSessionPath(path string) bool {
	pathWithoutQuery, _, _ := strings.Cut(path, "?")
	parts := nonEmptyPathParts(pathWithoutQuery)
	return len(parts) == 1 && parts[0] == "session"
}

func parseSubmitSessionID(path string) (string, bool) {
	pathWithoutQuery, _, _ := strings.Cut(path, "?")
	parts := nonEmptyPathParts(pathWithoutQuery)
	if len(parts) != 3 || parts[0] != "session" {
		return "", false
	}
	if parts[2] != "message" && parts[2] != "prompt_async" {
		return "", false
	}
	return parts[1], parts[1] != ""
}

func nonEmptyPathParts(path string) []string {
	rawParts := strings.Split(path, "/")
	parts := make([]string, 0, len(rawParts))
	for _, part := range rawParts {
		if part != "" {
			parts = append(parts, part)
		}
	}
	return parts
}

func extractCreatedSessionID(response StoredResponse) (*string, error) {
	if response.Status < 200 || response.Status >= 300 {
		return nil, nil
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(response.Body), &body); err != nil {
		return nil, err
	}
	id, ok := body["id"].(string)
	if !ok || id == "" {
		return nil, fmt.Errorf("OpenCode createConversation idempotency requires successful /session responses to include a string id")
	}
	return &id, nil
}

func deterministicMessageID(key string) string {
	digest := sha256.Sum256([]byte(key))
	return "msg_mistle_" + hex.EncodeToString(digest[:])
}

func nowTimestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func storeErrorStatus(err error) int {
	var conflict idempotency.FingerprintConflictError
	if errors.As(err, &conflict) {
		return 409
	}
	return 500
}
