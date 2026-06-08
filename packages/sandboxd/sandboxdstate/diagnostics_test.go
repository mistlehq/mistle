package sandboxdstate

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mistle/sandboxd/command"
	"github.com/mistle/sandboxd/process"
	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime"
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

func TestRecordOperationPhaseWriteFailuresAreBestEffort(t *testing.T) {
	logger, logPath, clock := initializeTestDiagnosticsLogger(t)
	requireNoError(t, os.Remove(logPath))
	requireNoError(t, os.Mkdir(logPath, 0o755))

	requireNoError(t, RecordOperationPhaseStartedWithAttributes(&logger, clock, "apply_runtime_plan", map[string]any{
		"timelineKey": "runtime-plan",
	}))
	requireNoError(t, RecordOperationPhaseCompleted(&logger, clock, "apply_runtime_plan"))
	requireNoError(t, RecordOperationPhaseFailure(&logger, clock, "apply_runtime_plan", map[string]any{
		"error": "boom",
	}))
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

func TestRuntimePlanTimelineObserverWritesStepRecords(t *testing.T) {
	logger, logPath, clock := initializeTestDiagnosticsLogger(t)
	observer := RuntimePlanTimelineObserver{Logger: &logger, Clock: clock}

	observer.RecordStepStarted(runtime.RuntimePlanApplyLifecycleRuntimeArtifacts)
	observer.RecordStepCompleted(runtime.RuntimePlanApplyLifecycleRuntimeArtifacts)

	records := startupdiagnosticsReadLogRecords(t, logPath)
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_started" &&
			record["phase"] == "apply_runtime_plan" &&
			record["timelineKey"] == "runtime-artifacts" &&
			record["timelineLabel"] == "Installing runtime artifacts"
	})
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_completed" &&
			record["phase"] == "apply_runtime_plan" &&
			record["timelineKey"] == "runtime-artifacts" &&
			record["timelineLabel"] == "Installing runtime artifacts"
	})
}

func TestRecordRuntimePlanApplyFailureWritesWorkspaceFailureAttributesAndTranscript(t *testing.T) {
	logger, logPath, clock := initializeTestDiagnosticsLogger(t)
	cloneURL := "https://proxy.example.test/repo.git"

	requireNoError(t, RecordRuntimePlanApplyFailure(&logger, clock, &runtime.RuntimePlanApplyError{
		Kind:       runtime.RuntimePlanApplyWorkspaceSourceError,
		SourceKind: runtime.WorkspaceSourceKindGitClone,
		Path:       "/workspace/repo",
		OriginURL:  "https://github.com/acme/repo.git",
		CloneURL:   &cloneURL,
		Cause:      errors.New("git clone failed"),
	}))

	records := startupdiagnosticsReadLogRecords(t, logPath)
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_failed" &&
			record["phase"] == "apply_runtime_plan" &&
			record["failureKind"] == "workspace_source_failed" &&
			record["timelineKey"] == "workspace" &&
			record["timelineLabel"] == "Preparing workspace" &&
			record["sourceKind"] == "git-clone" &&
			record["path"] == "/workspace/repo" &&
			record["originUrl"] == "https://github.com/acme/repo.git" &&
			record["cloneUrl"] == "https://proxy.example.test/repo.git" &&
			record["error"] == "git clone failed"
	})
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_transcript" &&
			record["phase"] == "apply_runtime_plan" &&
			record["stream"] == "system" &&
			record["message"] == "apply_runtime_plan failed: git clone failed"
	})
}

func TestRuntimeProcessTimelineObserverWritesProcessRecords(t *testing.T) {
	logger, logPath, clock := initializeTestDiagnosticsLogger(t)
	observer := RuntimeProcessTimelineObserver{Logger: &logger, Clock: clock}

	observer.RecordProcessStarted(process.RuntimeClientProcessSpec{ProcessKey: "opencode-server"})
	observer.RecordProcessCompleted(process.RuntimeClientProcessSpec{ProcessKey: "opencode-server"})

	records := startupdiagnosticsReadLogRecords(t, logPath)
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_started" &&
			record["phase"] == "start_runtime_processes" &&
			record["timelineKey"] == "runtime-process:opencode-server" &&
			record["timelineLabel"] == "Starting OpenCode server"
	})
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_completed" &&
			record["phase"] == "start_runtime_processes" &&
			record["timelineKey"] == "runtime-process:opencode-server" &&
			record["timelineLabel"] == "Starting OpenCode server"
	})
}

func TestRuntimeAdapterTimelineObserverWritesAdapterRecords(t *testing.T) {
	logger, logPath, clock := initializeTestDiagnosticsLogger(t)
	observer := RuntimeAdapterTimelineObserver{Logger: &logger, Clock: clock}

	observer.RecordAdapterStarted("codex")
	observer.RecordAdapterCompleted("codex")

	records := startupdiagnosticsReadLogRecords(t, logPath)
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_started" &&
			record["phase"] == "start_runtime_adapters" &&
			record["timelineKey"] == "runtime-adapter:codex" &&
			record["timelineLabel"] == "Starting Codex adapter"
	})
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_completed" &&
			record["phase"] == "start_runtime_adapters" &&
			record["timelineKey"] == "runtime-adapter:codex" &&
			record["timelineLabel"] == "Starting Codex adapter"
	})
}

func TestRecordRuntimeProcessFailureWritesSpawnFailureAttributesAndTranscript(t *testing.T) {
	logger, logPath, clock := initializeTestDiagnosticsLogger(t)
	processIndex := 1
	stdoutTail := "spawn stdout tail"
	stderrTail := "spawn stderr tail"

	requireNoError(t, RecordRuntimeProcessFailure(&logger, clock, &process.ProcessManagerError{
		Kind:         process.ProcessManagerStartProcessError,
		ProcessIndex: &processIndex,
		ProcessKey:   "codex-app-server",
		Cause:        errors.New("exec failed"),
		ProcessOutputTails: process.OutputTails{
			StdoutTail:     &stdoutTail,
			StderrTail:     &stderrTail,
			StdoutCaptured: true,
			StderrCaptured: true,
		},
	}))

	records := startupdiagnosticsReadLogRecords(t, logPath)
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_failed" &&
			record["phase"] == "start_runtime_processes" &&
			record["failureKind"] == "runtime_process_spawn_failed" &&
			record["processKey"] == "codex-app-server" &&
			record["processIndex"] == float64(1) &&
			record["timelineKey"] == "runtime-process:codex-app-server" &&
			record["timelineLabel"] == "Starting Codex app server" &&
			record["error"] == "exec failed" &&
			record["stdoutTail"] == "spawn stdout tail" &&
			record["stderrTail"] == "spawn stderr tail" &&
			record["stdoutCaptured"] == true &&
			record["stderrCaptured"] == true
	})
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_transcript" &&
			record["phase"] == "start_runtime_processes" &&
			record["stream"] == "system" &&
			record["message"] == "start_runtime_processes failed: exec failed"
	})
}

func TestRecordRuntimeProcessFailureWritesReadinessFailureAttributesAndTranscript(t *testing.T) {
	logger, logPath, clock := initializeTestDiagnosticsLogger(t)
	processIndex := 0
	stderrTail := "readiness stderr tail"

	requireNoError(t, RecordRuntimeProcessFailure(&logger, clock, &process.ProcessManagerError{
		Kind:         process.ProcessManagerReadinessCheckError,
		ProcessIndex: &processIndex,
		ProcessKey:   "opencode-server",
		Cause:        errors.New("healthcheck returned 503"),
		ReadinessFailure: &process.ProcessReadinessFailureDetails{
			ReadinessType:   "http",
			ReadinessTarget: "http://127.0.0.1:4096/global/health",
			TimeoutMS:       5000,
			OutputTails: process.OutputTails{
				StderrTail:     &stderrTail,
				StdoutCaptured: false,
				StderrCaptured: true,
			},
		},
	}))

	records := startupdiagnosticsReadLogRecords(t, logPath)
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_failed" &&
			record["phase"] == "start_runtime_processes" &&
			record["failureKind"] == "runtime_process_readiness_failed" &&
			record["processKey"] == "opencode-server" &&
			record["processIndex"] == float64(0) &&
			record["readinessType"] == "http" &&
			record["readinessTarget"] == "http://127.0.0.1:4096/global/health" &&
			record["timeoutMs"] == float64(5000) &&
			record["timelineKey"] == "runtime-process:opencode-server" &&
			record["timelineLabel"] == "Starting OpenCode server" &&
			record["error"] == "healthcheck returned 503" &&
			record["stderrTail"] == "readiness stderr tail" &&
			record["stdoutCaptured"] == false &&
			record["stderrCaptured"] == true
	})
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_transcript" &&
			record["phase"] == "start_runtime_processes" &&
			record["stream"] == "system" &&
			record["message"] == "start_runtime_processes failed: healthcheck returned 503"
	})
}

func TestRecordRuntimeAdapterFailureWritesRuntimeTimelineAttributesAndTranscript(t *testing.T) {
	logger, logPath, clock := initializeTestDiagnosticsLogger(t)

	requireNoError(t, RecordRuntimeAdapterFailure(
		&logger,
		clock,
		&RuntimeAdapterError{RuntimeID: "pi", Cause: errors.New("Pi runtime client setup must define MISTLE_PI_CLI_PATH")},
	))

	records := startupdiagnosticsReadLogRecords(t, logPath)
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_failed" &&
			record["phase"] == "start_runtime_adapters" &&
			record["timelineKey"] == "runtime-adapter:pi" &&
			record["timelineLabel"] == "Starting Pi adapter" &&
			record["error"] == "Pi runtime client setup must define MISTLE_PI_CLI_PATH"
	})
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_transcript" &&
			record["phase"] == "start_runtime_adapters" &&
			record["stream"] == "system" &&
			record["message"] == "start_runtime_adapters failed: Pi runtime client setup must define MISTLE_PI_CLI_PATH"
	})
}

func TestRecordRuntimeAdapterFailureWritesGenericTimelineAttributesWithoutRuntimeID(t *testing.T) {
	logger, logPath, clock := initializeTestDiagnosticsLogger(t)

	requireNoError(t, RecordRuntimeAdapterFailure(&logger, clock, errors.New("failed to load runtime adapter idempotency store")))

	records := startupdiagnosticsReadLogRecords(t, logPath)
	requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "sandbox_start_phase_failed" &&
			record["phase"] == "start_runtime_adapters" &&
			record["timelineKey"] == "runtime-adapters" &&
			record["timelineLabel"] == "Starting runtime adapter" &&
			record["error"] == "failed to load runtime adapter idempotency store"
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
