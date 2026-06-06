package sandboxdstate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mistle/sandboxd/command"
	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/startupdiagnostics"
	"github.com/mistle/sandboxd/timeutil"
)

func TestTimelineAttributesMatchRuntimeLabels(t *testing.T) {
	processAttributes := RuntimeProcessTimelineAttributes("codex-app-server")
	assertEqual(t, processAttributes["timelineKey"].(string), "runtime-process:codex-app-server")
	assertEqual(t, processAttributes["timelineLabel"].(string), "Starting Codex app server")

	adapterAttributes := RuntimeAdapterTimelineAttributes("opencode")
	assertEqual(t, adapterAttributes["timelineKey"].(string), "runtime-adapter:opencode")
	assertEqual(t, adapterAttributes["timelineLabel"].(string), "Starting OpenCode adapter")

	hiddenAttributes := HiddenTimelineAttributes()
	assertEqual(t, hiddenAttributes["timelineHidden"].(bool), true)
}

func TestRecordOperationPhaseStartedAndCompletedWriteTranscriptEntries(t *testing.T) {
	logger, logPath, clock := initializeTestDiagnosticsLogger(t)

	requireNoError(t, RecordOperationPhaseStartedWithAttributes(&logger, clock, "apply_runtime_plan", map[string]any{
		"timelineKey": "runtime-plan",
	}))
	requireNoError(t, RecordOperationPhaseCompleted(&logger, clock, "apply_runtime_plan"))

	records := startupdiagnosticsReadLogRecords(t, logPath)
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_started" &&
			record["phase"] == "apply_runtime_plan" &&
			record["timelineKey"] == "runtime-plan"
	})
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_transcript" &&
			record["phase"] == "apply_runtime_plan" &&
			record["stream"] == "system" &&
			record["message"] == "apply_runtime_plan started"
	})
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_completed" &&
			record["phase"] == "apply_runtime_plan"
	})
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_transcript" &&
			record["message"] == "apply_runtime_plan completed"
	})
}

func TestRecordSetupScriptFailureWritesFailureAttributesAndTranscript(t *testing.T) {
	logger, logPath, clock := initializeTestDiagnosticsLogger(t)
	exitCode := 17
	stdoutTail := "stdout tail"
	stderrTail := "stderr tail"

	requireNoError(t, RecordSetupScriptFailure(&logger, clock, command.Failure{
		Message:  "command failed with exit code 17",
		ExitCode: &exitCode,
		TimedOut: true,
		OutputTails: command.OutputTails{
			StdoutTail:     &stdoutTail,
			StderrTail:     &stderrTail,
			StdoutCaptured: true,
			StderrCaptured: true,
		},
	}))

	records := startupdiagnosticsReadLogRecords(t, logPath)
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_failed" &&
			record["phase"] == "run_setup_script" &&
			record["failureKind"] == "setup_script_failed" &&
			record["timelineKey"] == "setup-script" &&
			record["timelineLabel"] == "Running setup script" &&
			record["error"] == "command failed with exit code 17" &&
			record["exitCode"] == float64(17) &&
			record["stdoutTail"] == "stdout tail" &&
			record["stderrTail"] == "stderr tail" &&
			record["timedOut"] == true
	})
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_transcript" &&
			record["phase"] == "run_setup_script" &&
			record["stream"] == "system" &&
			record["message"] == "run_setup_script failed: command failed with exit code 17"
	})
}

func initializeTestDiagnosticsLogger(t *testing.T) (startupdiagnostics.ActivationDiagnosticsLogger, string, timeutil.Clock) {
	t.Helper()
	tempDir := t.TempDir()
	t.Setenv(startupdiagnostics.TestLogDirEnv, tempDir)
	logger, err := startupdiagnostics.InitializeActivationDiagnosticsLogger(
		startupdiagnostics.ActivationOperation{OperationKind: protocol.ActivationOperationStart},
		"ws://127.0.0.1:4000/tunnel/sandbox/sbi_diagnostics",
	)
	requireNoError(t, err)
	return logger, filepath.Join(tempDir, "activate.log"), timeutil.NewMutableClock(1650000000000)
}

func startupdiagnosticsReadLogRecords(t *testing.T, path string) []map[string]any {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected diagnostics log to exist, got %v", err)
	}
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

func requireStartupDiagnosticsRecord(t *testing.T, records []map[string]any, matches func(map[string]any) bool) {
	t.Helper()
	for _, record := range records {
		if matches(record) {
			return
		}
	}
	t.Fatalf("expected matching diagnostics record in %#v", records)
}
