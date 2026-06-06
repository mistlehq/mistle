package startupdiagnostics

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/timeutil"
)

func TestInitializesAndAppendsOperationLogLines(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv(TestLogDirEnv, tempDir)
	clock := timeutil.NewMutableClock(1650000000000)

	logger, err := InitializeActivationDiagnosticsLogger(
		ActivationOperation{OperationKind: protocol.ActivationOperationStart},
		"ws://127.0.0.1:4000/tunnel/sandbox/sbi_test",
	)
	requireNoError(t, err)
	requireNoError(t, logger.RecordStarted(clock))
	requireNoError(t, logger.RecordPhaseStarted(clock, "apply_runtime_plan"))
	requireNoError(t, logger.RecordPhaseCompleted(clock, "apply_runtime_plan"))
	phase := "apply_runtime_plan"
	requireNoError(t, logger.RecordTranscript(clock, &phase, ActivationTranscriptStdout, []byte("installing dependencies")))
	requireNoError(t, logger.RecordPhaseFailed(clock, "apply_runtime_plan", map[string]any{"error": "workspace clone failed"}))

	records := readLogRecords(t, filepath.Join(tempDir, "activate.log"))
	requireRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_started" && record["sandboxInstanceId"] == "sbi_test"
	})
	requireRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_started" && record["phase"] == "apply_runtime_plan"
	})
	requireRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_completed" && record["phase"] == "apply_runtime_plan"
	})
	requireRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_transcript" &&
			record["phase"] == "apply_runtime_plan" &&
			record["stream"] == "stdout" &&
			record["message"] == "installing dependencies" &&
			record["payloadBase64"] == "aW5zdGFsbGluZyBkZXBlbmRlbmNpZXM="
	})
	requireRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_failed" &&
			record["phase"] == "apply_runtime_plan" &&
			record["error"] == "workspace clone failed"
	})
	assertEqual(t, ActivateLogPath, "/run/mistle/activate.log")
}

func TestActivationDiagnosticsUseOperationKindRecords(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv(TestLogDirEnv, tempDir)
	clock := timeutil.NewMutableClock(1650000000000)

	logger, err := InitializeActivationDiagnosticsLogger(
		ActivationOperation{OperationKind: protocol.ActivationOperationSetupCheck},
		"ws://127.0.0.1:4000/tunnel/sandbox/sbi_test",
	)
	requireNoError(t, err)
	requireNoError(t, logger.RecordStarted(clock))
	requireNoError(t, logger.RecordPhaseStarted(clock, "apply_runtime_plan"))
	phase := "apply_runtime_plan"
	requireNoError(t, logger.RecordTranscript(clock, &phase, ActivationTranscriptStdout, []byte("installing dependencies")))

	records := readLogRecords(t, filepath.Join(tempDir, "activate.log"))
	requireRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_setup_check_started" &&
			record["operation"] == "activate" &&
			record["operationKind"] == "setup_check"
	})
	requireRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_setup_check_phase_started" &&
			record["operation"] == "activate" &&
			record["operationKind"] == "setup_check" &&
			record["phase"] == "apply_runtime_plan"
	})
	requireRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_setup_check_transcript" &&
			record["operation"] == "activate" &&
			record["operationKind"] == "setup_check" &&
			record["payloadBase64"] == "aW5zdGFsbGluZyBkZXBlbmRlbmNpZXM="
	})
}

func TestDeriveSandboxInstanceIDRequiresFinalPathSegment(t *testing.T) {
	_, err := DeriveSandboxInstanceID("ws://127.0.0.1:4000/")
	if err == nil {
		t.Fatalf("expected missing sandbox instance path segment to fail")
	}
	assertEqual(t, err.Error(), "invalid gateway url: tunnel gateway url must end with the sandbox instance id path segment")
}

func readLogRecords(t *testing.T, path string) []map[string]any {
	t.Helper()
	logText, err := os.ReadFile(path)
	requireNoError(t, err)
	lines := strings.Split(strings.TrimSpace(string(logText)), "\n")
	records := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("expected log line to be valid JSON, got %v", err)
		}
		records = append(records, record)
	}
	return records
}

func requireRecord(t *testing.T, records []map[string]any, matches func(map[string]any) bool) {
	t.Helper()
	for _, record := range records {
		if matches(record) {
			return
		}
	}
	t.Fatalf("expected matching record in %#v", records)
}
