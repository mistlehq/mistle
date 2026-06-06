package idempotency

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

const (
	CurrentIdempotencyRecordVersion  = uint8(1)
	CurrentRequestFingerprintVersion = uint8(1)
)

type AgentRuntimeID string

const (
	AgentRuntimeCodex    AgentRuntimeID = "codex"
	AgentRuntimeOpenCode AgentRuntimeID = "opencode"
	AgentRuntimePi       AgentRuntimeID = "pi"
)

type IdempotencyOperation string

const (
	IdempotencyOperationCreateConversation IdempotencyOperation = "create_conversation"
	IdempotencyOperationSubmitPayload      IdempotencyOperation = "submit_payload"
)

type IdempotencyRecordStatus string

const (
	IdempotencyRecordStarted   IdempotencyRecordStatus = "started"
	IdempotencyRecordAccepted  IdempotencyRecordStatus = "accepted"
	IdempotencyRecordCompleted IdempotencyRecordStatus = "completed"
)

type RequestFingerprint string

func RequestFingerprintFromFields(runtimeID AgentRuntimeID, operation IdempotencyOperation, fields map[string]any) (RequestFingerprint, error) {
	payload := requestFingerprintPayload{
		Version:   CurrentRequestFingerprintVersion,
		RuntimeID: runtimeID,
		Operation: operation,
		Fields:    fields,
	}
	serialized, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("failed to encode idempotency request fingerprint: %w", err)
	}
	digest := sha256.Sum256(serialized)
	return RequestFingerprint("sha256:" + hex.EncodeToString(digest[:])), nil
}

func (fingerprint RequestFingerprint) Value() string {
	return string(fingerprint)
}

type requestFingerprintPayload struct {
	Version   uint8                `json:"version"`
	RuntimeID AgentRuntimeID       `json:"runtime_id"`
	Operation IdempotencyOperation `json:"operation"`
	Fields    map[string]any       `json:"fields"`
}

type IdempotencyRecord struct {
	Version                uint8                   `json:"version"`
	Key                    string                  `json:"key"`
	RuntimeID              AgentRuntimeID          `json:"runtimeId"`
	Operation              IdempotencyOperation    `json:"operation"`
	RequestFingerprint     RequestFingerprint      `json:"requestFingerprint"`
	Status                 IdempotencyRecordStatus `json:"status"`
	ProviderConversationID *string                 `json:"providerConversationId"`
	ProviderExecutionID    *string                 `json:"providerExecutionId"`
	RuntimeArtifactHint    any                     `json:"runtimeArtifactHint"`
	CreatedAt              string                  `json:"createdAt"`
	UpdatedAt              string                  `json:"updatedAt"`
	Response               any                     `json:"response"`
}

func StartedRecord(input StartOperation) IdempotencyRecord {
	return IdempotencyRecord{
		Version:            CurrentIdempotencyRecordVersion,
		Key:                input.Key,
		RuntimeID:          input.RuntimeID,
		Operation:          input.Operation,
		RequestFingerprint: input.RequestFingerprint,
		Status:             IdempotencyRecordStarted,
		CreatedAt:          input.Now,
		UpdatedAt:          input.Now,
	}
}

func (record IdempotencyRecord) ClassifyRepeatedRequest(requestFingerprint RequestFingerprint) (RepeatedRequestOutcome, error) {
	if err := record.ensureSameFingerprint(requestFingerprint); err != nil {
		return "", err
	}
	switch record.Status {
	case IdempotencyRecordStarted:
		return RepeatedRequestStarted, nil
	case IdempotencyRecordAccepted:
		return RepeatedRequestAccepted, nil
	case IdempotencyRecordCompleted:
		return RepeatedRequestCompleted, nil
	default:
		return "", fmt.Errorf("unsupported idempotency record status: %s", record.Status)
	}
}

func (record IdempotencyRecord) MarkAccepted(input AcceptOperation) (IdempotencyRecord, error) {
	if err := record.ensureSameFingerprint(input.RequestFingerprint); err != nil {
		return IdempotencyRecord{}, err
	}
	if record.Status != IdempotencyRecordStarted {
		return IdempotencyRecord{}, InvalidTransitionError{From: record.Status, To: IdempotencyRecordAccepted}
	}
	next := record
	next.Status = IdempotencyRecordAccepted
	next.ProviderConversationID = input.ProviderConversationID
	next.ProviderExecutionID = input.ProviderExecutionID
	next.RuntimeArtifactHint = input.RuntimeArtifactHint
	next.UpdatedAt = input.Now
	return next, nil
}

func (record IdempotencyRecord) MarkCompleted(input CompleteOperation) (IdempotencyRecord, error) {
	if err := record.ensureSameFingerprint(input.RequestFingerprint); err != nil {
		return IdempotencyRecord{}, err
	}
	if record.Status == IdempotencyRecordCompleted {
		return IdempotencyRecord{}, InvalidTransitionError{From: record.Status, To: IdempotencyRecordCompleted}
	}
	if record.Status == IdempotencyRecordAccepted {
		if err := record.ensureCompletionMetadataMatchesAccepted(input); err != nil {
			return IdempotencyRecord{}, err
		}
	}
	next := record
	next.Status = IdempotencyRecordCompleted
	if record.Status == IdempotencyRecordStarted {
		next.ProviderConversationID = input.ProviderConversationID
		next.ProviderExecutionID = input.ProviderExecutionID
		next.RuntimeArtifactHint = input.RuntimeArtifactHint
	}
	next.Response = input.Response
	next.UpdatedAt = input.Now
	return next, nil
}

func (record IdempotencyRecord) ensureSameFingerprint(requestFingerprint RequestFingerprint) error {
	if record.RequestFingerprint == requestFingerprint {
		return nil
	}
	return FingerprintConflictError{
		Key:      record.Key,
		Existing: record.RequestFingerprint,
		Received: requestFingerprint,
	}
}

func (record IdempotencyRecord) ensureCompletionMetadataMatchesAccepted(input CompleteOperation) error {
	if !sameStringPointer(record.ProviderConversationID, input.ProviderConversationID) {
		return ProviderMetadataConflictError{Field: "provider_conversation_id"}
	}
	if !sameStringPointer(record.ProviderExecutionID, input.ProviderExecutionID) {
		return ProviderMetadataConflictError{Field: "provider_execution_id"}
	}
	if !sameJSONValue(record.RuntimeArtifactHint, input.RuntimeArtifactHint) {
		return ProviderMetadataConflictError{Field: "runtime_artifact_hint"}
	}
	return nil
}

type RepeatedRequestOutcome string

const (
	RepeatedRequestStarted   RepeatedRequestOutcome = "started"
	RepeatedRequestAccepted  RepeatedRequestOutcome = "accepted"
	RepeatedRequestCompleted RepeatedRequestOutcome = "completed"
)

type StartOperation struct {
	Key                string
	RuntimeID          AgentRuntimeID
	Operation          IdempotencyOperation
	RequestFingerprint RequestFingerprint
	Now                string
}

type AcceptOperation struct {
	RequestFingerprint     RequestFingerprint
	ProviderConversationID *string
	ProviderExecutionID    *string
	RuntimeArtifactHint    any
	Now                    string
}

type CompleteOperation struct {
	RequestFingerprint     RequestFingerprint
	ProviderConversationID *string
	ProviderExecutionID    *string
	RuntimeArtifactHint    any
	Response               any
	Now                    string
}

type FingerprintConflictError struct {
	Key      string
	Existing RequestFingerprint
	Received RequestFingerprint
}

func (err FingerprintConflictError) Error() string {
	return fmt.Sprintf("idempotency key '%s' was reused with a different request fingerprint", err.Key)
}

type InvalidTransitionError struct {
	From IdempotencyRecordStatus
	To   IdempotencyRecordStatus
}

func (err InvalidTransitionError) Error() string {
	return fmt.Sprintf("invalid idempotency record transition from %s to %s", err.From, err.To)
}

type ProviderMetadataConflictError struct {
	Field string
}

func (err ProviderMetadataConflictError) Error() string {
	return fmt.Sprintf("idempotency provider metadata conflict for %s", err.Field)
}

func sameStringPointer(left *string, right *string) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}

func sameJSONValue(left any, right any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && string(leftJSON) == string(rightJSON)
}
