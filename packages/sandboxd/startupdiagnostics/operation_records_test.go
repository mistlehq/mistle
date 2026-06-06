package startupdiagnostics

import (
	"encoding/json"
	"testing"

	"github.com/mistle/sandboxd/protocol"
)

func TestBuildsLifecycleOperationRecordLines(t *testing.T) {
	operation := ActivationOperation{OperationKind: protocol.ActivationOperationStart}

	line, err := OperationRecordLine(operation, "2026-05-21T00:00:00Z", "sandbox_start_phase_started", map[string]any{
		"timestamp":         "2026-05-21T00:00:00Z",
		"level":             "info",
		"event":             "sandbox_start_phase_started",
		"sandboxInstanceId": "sbi_test",
		"operation":         "activate",
		"phase":             "apply_runtime_plan",
		"attempt":           float64(2),
	})
	requireOperationRecordLine(t, line, err)

	record := decodeRecordLine(t, *line)
	assertEqual(t, record["kind"].(string), "lifecycle")
	assertEqual(t, record["observedAt"].(string), "2026-05-21T00:00:00Z")
	assertEqual(t, record["phase"].(string), "runtime_plan")
	assertEqual(t, record["status"].(string), "started")
	assertEqual(t, record["source"].(string), "sandboxd")
	assertEqual(t, record["message"].(string), "runtime_plan started")
	attributes := record["attributes"].(map[string]any)
	assertEqual(t, attributes["phase"].(string), "apply_runtime_plan")
	assertEqual(t, attributes["attempt"].(float64), 2)
	if _, ok := attributes["sandboxInstanceId"]; ok {
		t.Fatalf("expected lifecycle attributes to omit sandboxInstanceId")
	}
}

func TestBuildsTranscriptOperationRecordLines(t *testing.T) {
	operation := ActivationOperation{OperationKind: protocol.ActivationOperationSetupCheck}

	line, err := OperationRecordLine(operation, "2026-05-21T00:00:00Z", "sandbox_setup_check_transcript", map[string]any{
		"phase":         "run_setup_script",
		"stream":        "stdout",
		"payloadBase64": "aW5zdGFsbGluZyBkZXBlbmRlbmNpZXM=",
	})
	requireOperationRecordLine(t, line, err)

	record := decodeRecordLine(t, *line)
	assertEqual(t, record["kind"].(string), "transcript")
	assertEqual(t, record["phase"].(string), "setup_script")
	assertEqual(t, record["stream"].(string), "stdout")
	assertEqual(t, record["payloadBase64"].(string), "aW5zdGFsbGluZyBkZXBlbmRlbmNpZXM=")
}

func TestMapsCleanupPhasesToTheResourceBeingCleanedUp(t *testing.T) {
	operationStreamPhase, ok := OperationLifecyclePhase("stop_tunnel_session_after_runtime_plan_failure")
	if !ok {
		t.Fatalf("expected tunnel cleanup phase to map")
	}
	assertEqual(t, operationStreamPhase, "operation_stream")

	teardownPhase, ok := OperationLifecyclePhase("stop_egress_proxy_after_setup_failure")
	if !ok {
		t.Fatalf("expected egress cleanup phase to map")
	}
	assertEqual(t, teardownPhase, "teardown")
}

func TestDoesNotPublishTopLevelSandboxdLifecycleOperationRecords(t *testing.T) {
	operation := ActivationOperation{OperationKind: protocol.ActivationOperationStart}

	startedRecord, err := OperationRecordLine(operation, "2026-05-21T00:00:00Z", "sandbox_start_started", map[string]any{
		"timestamp":         "2026-05-21T00:00:00Z",
		"level":             "info",
		"event":             "sandbox_start_started",
		"sandboxInstanceId": "sbi_test",
		"operation":         "activate",
	})
	requireNoError(t, err)
	if startedRecord != nil {
		t.Fatalf("expected top-level started record to be suppressed, got %q", *startedRecord)
	}

	failedRecord, err := OperationRecordLine(operation, "2026-05-21T00:00:01Z", "sandbox_start_failed", map[string]any{
		"timestamp":         "2026-05-21T00:00:01Z",
		"level":             "error",
		"event":             "sandbox_start_failed",
		"sandboxInstanceId": "sbi_test",
		"operation":         "activate",
		"error":             "runtime plan failed",
	})
	requireNoError(t, err)
	if failedRecord != nil {
		t.Fatalf("expected top-level failed record to be suppressed, got %q", *failedRecord)
	}
}

func TestDoesNotAttributeUnknownLifecyclePhasesToSandboxd(t *testing.T) {
	if _, ok := OperationLifecyclePhase("unexpected_internal_phase"); ok {
		t.Fatalf("expected unknown phase not to map")
	}

	operationRecord, err := OperationRecordLine(
		ActivationOperation{OperationKind: protocol.ActivationOperationStart},
		"2026-05-21T00:00:00Z",
		"sandbox_start_phase_failed",
		map[string]any{
			"timestamp":         "2026-05-21T00:00:00Z",
			"level":             "error",
			"event":             "sandbox_start_phase_failed",
			"sandboxInstanceId": "sbi_test",
			"operation":         "activate",
			"phase":             "unexpected_internal_phase",
			"error":             "failed",
		},
	)
	requireNoError(t, err)
	if operationRecord != nil {
		t.Fatalf("expected unknown phase record to be suppressed, got %q", *operationRecord)
	}
}

func requireOperationRecordLine(t *testing.T, line *string, err error) {
	t.Helper()
	requireNoError(t, err)
	if line == nil {
		t.Fatalf("expected operation record line")
	}
}

func decodeRecordLine(t *testing.T, line string) map[string]any {
	t.Helper()
	var record map[string]any
	if err := json.Unmarshal([]byte(line), &record); err != nil {
		t.Fatalf("expected operation record JSON line, got %v", err)
	}
	return record
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
