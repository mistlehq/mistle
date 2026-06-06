package idempotency

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStoreStartOperationPersistsRecordAndReloadsIndex(t *testing.T) {
	root := filepath.Join(t.TempDir(), "var/lib/mistle/sandboxd/idempotency")
	store, err := LoadStore(root)
	requireNoError(t, err)
	fingerprint := submitFingerprint(t, "hello")

	started, err := store.StartOperation(StartOperation{
		Key:                "delivery_key",
		RuntimeID:          AgentRuntimeCodex,
		Operation:          IdempotencyOperationSubmitPayload,
		RequestFingerprint: fingerprint,
		Now:                "2026-05-23T00:00:00Z",
	})
	requireNoError(t, err)

	assertEqual(t, started.Status, IdempotencyRecordStarted)
	if _, err := os.Stat(store.RecordPath(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "delivery_key")); err != nil {
		t.Fatalf("expected persisted record: %v", err)
	}

	reloaded, err := LoadStore(root)
	requireNoError(t, err)
	record, err := reloaded.GetByKey(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "delivery_key")
	requireNoError(t, err)
	assertEqual(t, record.Key, "delivery_key")
	assertEqual(t, record.RequestFingerprint, fingerprint)
	assertEqual(t, record.Status, IdempotencyRecordStarted)
}

func TestRepeatedStartWithSameFingerprintReturnsExistingRecordWithoutOverwrite(t *testing.T) {
	root := filepath.Join(t.TempDir(), "idempotency")
	store, err := LoadStore(root)
	requireNoError(t, err)
	fingerprint := submitFingerprint(t, "hello")

	_, err = store.StartOperation(StartOperation{
		Key:                "delivery_key",
		RuntimeID:          AgentRuntimeCodex,
		Operation:          IdempotencyOperationSubmitPayload,
		RequestFingerprint: fingerprint,
		Now:                "2026-05-23T00:00:00Z",
	})
	requireNoError(t, err)
	repeated, err := store.StartOperation(StartOperation{
		Key:                "delivery_key",
		RuntimeID:          AgentRuntimeCodex,
		Operation:          IdempotencyOperationSubmitPayload,
		RequestFingerprint: fingerprint,
		Now:                "2026-05-23T00:01:00Z",
	})
	requireNoError(t, err)

	assertEqual(t, repeated.CreatedAt, "2026-05-23T00:00:00Z")
	assertEqual(t, repeated.UpdatedAt, "2026-05-23T00:00:00Z")
}

func TestRepeatedStartWithDifferentFingerprintFailsWithConflict(t *testing.T) {
	root := filepath.Join(t.TempDir(), "idempotency")
	store, err := LoadStore(root)
	requireNoError(t, err)
	_, err = store.StartOperation(StartOperation{
		Key:                "delivery_key",
		RuntimeID:          AgentRuntimeCodex,
		Operation:          IdempotencyOperationSubmitPayload,
		RequestFingerprint: submitFingerprint(t, "hello"),
		Now:                "2026-05-23T00:00:00Z",
	})
	requireNoError(t, err)

	_, err = store.StartOperation(StartOperation{
		Key:                "delivery_key",
		RuntimeID:          AgentRuntimeCodex,
		Operation:          IdempotencyOperationSubmitPayload,
		RequestFingerprint: submitFingerprint(t, "different"),
		Now:                "2026-05-23T00:01:00Z",
	})

	var conflict FingerprintConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("expected FingerprintConflictError, got %v", err)
	}
}

func TestSameOperationAndKeyAreScopedByRuntimeID(t *testing.T) {
	root := filepath.Join(t.TempDir(), "idempotency")
	store, err := LoadStore(root)
	requireNoError(t, err)

	codexRecord, err := store.StartOperation(StartOperation{
		Key:                "shared_key",
		RuntimeID:          AgentRuntimeCodex,
		Operation:          IdempotencyOperationSubmitPayload,
		RequestFingerprint: submitFingerprint(t, "codex"),
		Now:                "2026-05-23T00:00:00Z",
	})
	requireNoError(t, err)
	opencodeRecord, err := store.StartOperation(StartOperation{
		Key:                "shared_key",
		RuntimeID:          AgentRuntimeOpenCode,
		Operation:          IdempotencyOperationSubmitPayload,
		RequestFingerprint: opencodeSubmitFingerprint(t, "opencode"),
		Now:                "2026-05-23T00:00:01Z",
	})
	requireNoError(t, err)

	if store.RecordPath(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "shared_key") == store.RecordPath(AgentRuntimeOpenCode, IdempotencyOperationSubmitPayload, "shared_key") {
		t.Fatalf("expected runtime-specific record paths")
	}
	assertEqual(t, codexRecord.RuntimeID, AgentRuntimeCodex)
	assertEqual(t, opencodeRecord.RuntimeID, AgentRuntimeOpenCode)
}

func TestDeleteStartedRemovesMatchingStartedRecord(t *testing.T) {
	root := filepath.Join(t.TempDir(), "idempotency")
	store, err := LoadStore(root)
	requireNoError(t, err)
	fingerprint := submitFingerprint(t, "hello")
	_, err = store.StartOperation(StartOperation{
		Key:                "delivery_key",
		RuntimeID:          AgentRuntimeCodex,
		Operation:          IdempotencyOperationSubmitPayload,
		RequestFingerprint: fingerprint,
		Now:                "2026-05-23T00:00:00Z",
	})
	requireNoError(t, err)

	err = store.DeleteStarted(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "delivery_key", fingerprint)
	requireNoError(t, err)

	if _, err := store.GetByKey(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "delivery_key"); err == nil {
		t.Fatalf("expected deleted record to be removed from index")
	}
	if _, err := os.Stat(store.RecordPath(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "delivery_key")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected deleted record to be removed from disk, got %v", err)
	}
}

func TestAcceptedAndCompletedUpdatesPersistAcrossReload(t *testing.T) {
	root := filepath.Join(t.TempDir(), "idempotency")
	store, err := LoadStore(root)
	requireNoError(t, err)
	fingerprint := submitFingerprint(t, "hello")
	_, err = store.StartOperation(StartOperation{
		Key:                "delivery_key",
		RuntimeID:          AgentRuntimeCodex,
		Operation:          IdempotencyOperationSubmitPayload,
		RequestFingerprint: fingerprint,
		Now:                "2026-05-23T00:00:00Z",
	})
	requireNoError(t, err)
	threadID := "thread_123"
	turnID := "turn_123"
	hint := map[string]any{"rolloutPath": "/root/.codex/session.jsonl"}
	_, err = store.MarkAccepted(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "delivery_key", AcceptOperation{
		RequestFingerprint:     fingerprint,
		ProviderConversationID: &threadID,
		ProviderExecutionID:    &turnID,
		RuntimeArtifactHint:    hint,
		Now:                    "2026-05-23T00:00:01Z",
	})
	requireNoError(t, err)
	_, err = store.MarkCompleted(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "delivery_key", CompleteOperation{
		RequestFingerprint:     fingerprint,
		ProviderConversationID: &threadID,
		ProviderExecutionID:    &turnID,
		RuntimeArtifactHint:    hint,
		Response:               map[string]any{"accepted": true},
		Now:                    "2026-05-23T00:00:02Z",
	})
	requireNoError(t, err)

	reloaded, err := LoadStore(root)
	requireNoError(t, err)
	record, err := reloaded.GetByKey(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "delivery_key")
	requireNoError(t, err)
	assertEqual(t, record.Status, IdempotencyRecordCompleted)
	if record.ProviderConversationID == nil {
		t.Fatalf("expected provider conversation id")
	}
	assertEqual(t, *record.ProviderConversationID, "thread_123")
}

func TestMarkAcceptedRequiresExistingRecord(t *testing.T) {
	root := filepath.Join(t.TempDir(), "idempotency")
	store, err := LoadStore(root)
	requireNoError(t, err)

	_, err = store.MarkAccepted(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "missing_key", AcceptOperation{
		RequestFingerprint: submitFingerprint(t, "hello"),
		Now:                "2026-05-23T00:00:01Z",
	})

	var missing MissingRecordError
	if !errors.As(err, &missing) {
		t.Fatalf("expected MissingRecordError, got %v", err)
	}
}

func TestLoadStoreFailsOnCorruptRecordJSON(t *testing.T) {
	root := filepath.Join(t.TempDir(), "idempotency")
	requireNoError(t, os.MkdirAll(root, 0o700))
	requireNoError(t, os.WriteFile(filepath.Join(root, "submit-payload-corrupt.json"), []byte("{"), 0o600))

	_, err := LoadStore(root)

	if err == nil {
		t.Fatalf("expected corrupt record to fail load")
	}
}

func TestLoadStoreRemovesInterruptedAtomicWriteTempFiles(t *testing.T) {
	root := filepath.Join(t.TempDir(), "idempotency")
	store, err := LoadStore(root)
	requireNoError(t, err)
	_, err = store.StartOperation(StartOperation{
		Key:                "delivery_key",
		RuntimeID:          AgentRuntimeCodex,
		Operation:          IdempotencyOperationSubmitPayload,
		RequestFingerprint: submitFingerprint(t, "hello"),
		Now:                "2026-05-23T00:00:00Z",
	})
	requireNoError(t, err)
	recordPath := store.RecordPath(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "delivery_key")
	recordFileStem := strings.TrimSuffix(filepath.Base(recordPath), ".json")
	tempPath := filepath.Join(root, "."+recordFileStem+".99.tmp")
	requireNoError(t, os.WriteFile(tempPath, []byte("partially written temp record"), 0o600))

	reloaded, err := LoadStore(root)
	requireNoError(t, err)

	if _, err := os.Stat(tempPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected stale temp file to be removed, got %v", err)
	}
	_, err = reloaded.GetByKey(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "delivery_key")
	requireNoError(t, err)
}

func TestLoadStoreStillFailsOnUnexpectedNonJSONFiles(t *testing.T) {
	root := filepath.Join(t.TempDir(), "idempotency")
	requireNoError(t, os.MkdirAll(root, 0o700))
	requireNoError(t, os.WriteFile(filepath.Join(root, ".not-an-owned-temp-file.tmp"), []byte("unexpected"), 0o600))

	_, err := LoadStore(root)

	if err == nil {
		t.Fatalf("expected unexpected file to fail load")
	}
}

func TestLoadStoreRejectsUnsupportedRecordVersions(t *testing.T) {
	root := filepath.Join(t.TempDir(), "idempotency")
	store, err := LoadStore(root)
	requireNoError(t, err)
	_, err = store.StartOperation(StartOperation{
		Key:                "delivery_key",
		RuntimeID:          AgentRuntimeCodex,
		Operation:          IdempotencyOperationSubmitPayload,
		RequestFingerprint: submitFingerprint(t, "hello"),
		Now:                "2026-05-23T00:00:00Z",
	})
	requireNoError(t, err)
	recordPath := store.RecordPath(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, "delivery_key")
	contents, err := os.ReadFile(recordPath)
	requireNoError(t, err)
	var record map[string]any
	requireNoError(t, json.Unmarshal(contents, &record))
	record["version"] = float64(2)
	updated, err := json.MarshalIndent(record, "", "  ")
	requireNoError(t, err)
	requireNoError(t, os.WriteFile(recordPath, updated, 0o600))

	_, err = LoadStore(root)

	if err == nil {
		t.Fatalf("expected unsupported version to fail load")
	}
}

func TestLoadStoreFailsWhenRecordIsStoredAtWrongPath(t *testing.T) {
	root := filepath.Join(t.TempDir(), "idempotency")
	store, err := LoadStore(root)
	requireNoError(t, err)
	record, err := store.StartOperation(StartOperation{
		Key:                "delivery_key",
		RuntimeID:          AgentRuntimeCodex,
		Operation:          IdempotencyOperationSubmitPayload,
		RequestFingerprint: submitFingerprint(t, "hello"),
		Now:                "2026-05-23T00:00:00Z",
	})
	requireNoError(t, err)
	wrongRoot := filepath.Join(t.TempDir(), "wrong-idempotency")
	requireNoError(t, os.MkdirAll(wrongRoot, 0o700))
	recordJSON, err := json.MarshalIndent(record, "", "  ")
	requireNoError(t, err)
	requireNoError(t, os.WriteFile(filepath.Join(wrongRoot, "submit-payload-wrong.json"), recordJSON, 0o600))

	_, err = LoadStore(wrongRoot)

	if err == nil {
		t.Fatalf("expected wrong-path record to fail load")
	}
}

func submitFingerprint(t *testing.T, inputText string) RequestFingerprint {
	t.Helper()
	fingerprint, err := RequestFingerprintFromFields(AgentRuntimeCodex, IdempotencyOperationSubmitPayload, map[string]any{
		"inputText":            inputText,
		"logicalOperationKind": "submitPayload",
	})
	requireNoError(t, err)
	return fingerprint
}

func opencodeSubmitFingerprint(t *testing.T, inputText string) RequestFingerprint {
	t.Helper()
	fingerprint, err := RequestFingerprintFromFields(AgentRuntimeOpenCode, IdempotencyOperationSubmitPayload, map[string]any{
		"inputText": inputText,
	})
	requireNoError(t, err)
	return fingerprint
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
