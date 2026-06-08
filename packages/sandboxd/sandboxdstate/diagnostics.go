package sandboxdstate

import (
	"errors"
	"fmt"
	"os"

	"github.com/mistle/sandboxd/command"
	"github.com/mistle/sandboxd/process"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/startupdiagnostics"
	"github.com/mistle/sandboxd/timeutil"
)

func TimelineAttributes(key string, label string) map[string]any {
	return map[string]any{
		"timelineKey":   key,
		"timelineLabel": label,
	}
}

func HiddenTimelineAttributes() map[string]any {
	return map[string]any{"timelineHidden": true}
}

func RuntimeProcessTimelineAttributes(processKey string) map[string]any {
	return TimelineAttributes(
		"runtime-process:"+processKey,
		runtimeProcessTimelineLabel(processKey),
	)
}

func RuntimeAdapterTimelineAttributes(runtimeID string) map[string]any {
	return TimelineAttributes(
		"runtime-adapter:"+runtimeID,
		runtimeAdapterTimelineLabel(runtimeID),
	)
}

func RecordOperationPhaseStarted(
	logger *startupdiagnostics.ActivationDiagnosticsLogger,
	clock timeutil.Clock,
	phase string,
) error {
	return RecordOperationPhaseStartedWithAttributes(logger, clock, phase, nil)
}

func RecordOperationPhaseStartedWithAttributes(
	logger *startupdiagnostics.ActivationDiagnosticsLogger,
	clock timeutil.Clock,
	phase string,
	attributes map[string]any,
) error {
	if logger == nil {
		return nil
	}
	if err := logger.RecordPhaseStartedWithAttributes(clock, phase, attributes); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics phase start: %v\n", err)
	}
	if err := logger.RecordTranscript(clock, &phase, startupdiagnostics.ActivationTranscriptSystem, []byte(phase+" started")); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics transcript: %v\n", err)
	}
	return nil
}

func RecordOperationPhaseCompleted(
	logger *startupdiagnostics.ActivationDiagnosticsLogger,
	clock timeutil.Clock,
	phase string,
) error {
	return RecordOperationPhaseCompletedWithAttributes(logger, clock, phase, nil)
}

func RecordOperationPhaseCompletedWithAttributes(
	logger *startupdiagnostics.ActivationDiagnosticsLogger,
	clock timeutil.Clock,
	phase string,
	attributes map[string]any,
) error {
	if logger == nil {
		return nil
	}
	if err := logger.RecordPhaseCompletedWithAttributes(clock, phase, attributes); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics phase completion: %v\n", err)
	}
	if err := logger.RecordTranscript(clock, &phase, startupdiagnostics.ActivationTranscriptSystem, []byte(phase+" completed")); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics transcript: %v\n", err)
	}
	return nil
}

func RecordOperationPhaseFailure(
	logger *startupdiagnostics.ActivationDiagnosticsLogger,
	clock timeutil.Clock,
	phase string,
	attributes map[string]any,
) error {
	if logger == nil {
		return nil
	}
	transcriptMessage := phase + " failed"
	if errorValue, ok := attributes["error"].(string); ok {
		transcriptMessage = fmt.Sprintf("%s failed: %s", phase, errorValue)
	}
	if err := logger.RecordPhaseFailed(clock, phase, attributes); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics phase failure: %v\n", err)
	}
	if err := logger.RecordTranscript(clock, &phase, startupdiagnostics.ActivationTranscriptSystem, []byte(transcriptMessage)); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics transcript: %v\n", err)
	}
	return nil
}

func RecordSetupScriptFailure(
	logger *startupdiagnostics.ActivationDiagnosticsLogger,
	clock timeutil.Clock,
	failure command.Failure,
) error {
	attributes := TimelineAttributes("setup-script", "Running setup script")
	attributes["failureKind"] = "setup_script_failed"
	attributes["error"] = failure.Message
	attributes["stdoutCaptured"] = failure.OutputTails.StdoutCaptured
	attributes["stderrCaptured"] = failure.OutputTails.StderrCaptured
	if failure.ExitCode != nil {
		attributes["exitCode"] = uint64(*failure.ExitCode)
	}
	if failure.OutputTails.StdoutTail != nil {
		attributes["stdoutTail"] = *failure.OutputTails.StdoutTail
	}
	if failure.OutputTails.StderrTail != nil {
		attributes["stderrTail"] = *failure.OutputTails.StderrTail
	}
	if failure.TimedOut {
		attributes["timedOut"] = true
	}

	return RecordOperationPhaseFailure(logger, clock, "run_setup_script", attributes)
}

type RuntimePlanTimelineObserver struct {
	Logger *startupdiagnostics.ActivationDiagnosticsLogger
	Clock  timeutil.Clock
}

func (observer RuntimePlanTimelineObserver) RecordStepStarted(step runtime.RuntimePlanApplyLifecycleStep) {
	key, label := runtimePlanTimelineStep(step)
	if err := RecordOperationPhaseStartedWithAttributes(observer.Logger, observer.Clock, "apply_runtime_plan", TimelineAttributes(key, label)); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics runtime plan step start: %v\n", err)
	}
}

func (observer RuntimePlanTimelineObserver) RecordStepCompleted(step runtime.RuntimePlanApplyLifecycleStep) {
	key, label := runtimePlanTimelineStep(step)
	if err := RecordOperationPhaseCompletedWithAttributes(observer.Logger, observer.Clock, "apply_runtime_plan", TimelineAttributes(key, label)); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics runtime plan step completion: %v\n", err)
	}
}

func RecordRuntimePlanApplyFailure(
	logger *startupdiagnostics.ActivationDiagnosticsLogger,
	clock timeutil.Clock,
	err error,
) error {
	attributes := map[string]any{"error": "runtime plan apply failed"}
	if err != nil {
		attributes["error"] = err.Error()
	}
	var applyErr *runtime.RuntimePlanApplyError
	if errors.As(err, &applyErr) {
		for key, value := range runtimePlanApplyFailureAttributes(applyErr) {
			attributes[key] = value
		}
	}
	return RecordOperationPhaseFailure(logger, clock, "apply_runtime_plan", attributes)
}

type RuntimeProcessTimelineObserver struct {
	Logger *startupdiagnostics.ActivationDiagnosticsLogger
	Clock  timeutil.Clock
}

func (observer RuntimeProcessTimelineObserver) RecordProcessStarted(processSpec process.RuntimeClientProcessSpec) {
	if err := RecordOperationPhaseStartedWithAttributes(
		observer.Logger,
		observer.Clock,
		"start_runtime_processes",
		RuntimeProcessTimelineAttributes(processSpec.ProcessKey),
	); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics runtime process start: %v\n", err)
	}
}

func (observer RuntimeProcessTimelineObserver) RecordProcessCompleted(processSpec process.RuntimeClientProcessSpec) {
	if err := RecordOperationPhaseCompletedWithAttributes(
		observer.Logger,
		observer.Clock,
		"start_runtime_processes",
		RuntimeProcessTimelineAttributes(processSpec.ProcessKey),
	); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics runtime process completion: %v\n", err)
	}
}

type RuntimeAdapterTimelineObserver struct {
	Logger *startupdiagnostics.ActivationDiagnosticsLogger
	Clock  timeutil.Clock
}

func (observer RuntimeAdapterTimelineObserver) RecordAdapterStarted(runtimeID string) {
	if err := RecordOperationPhaseStartedWithAttributes(
		observer.Logger,
		observer.Clock,
		"start_runtime_adapters",
		RuntimeAdapterTimelineAttributes(runtimeID),
	); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics runtime adapter start: %v\n", err)
	}
}

func (observer RuntimeAdapterTimelineObserver) RecordAdapterCompleted(runtimeID string) {
	if err := RecordOperationPhaseCompletedWithAttributes(
		observer.Logger,
		observer.Clock,
		"start_runtime_adapters",
		RuntimeAdapterTimelineAttributes(runtimeID),
	); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics runtime adapter completion: %v\n", err)
	}
}

func RecordRuntimeProcessFailure(
	logger *startupdiagnostics.ActivationDiagnosticsLogger,
	clock timeutil.Clock,
	processErr *process.ProcessManagerError,
) error {
	if processErr == nil {
		return RecordOperationPhaseFailure(logger, clock, "start_runtime_processes", map[string]any{
			"error": "runtime process startup failed",
		})
	}
	attributes := runtimeProcessFailureAttributes(processErr)
	return RecordOperationPhaseFailure(logger, clock, "start_runtime_processes", attributes)
}

func RecordRuntimeAdapterFailure(
	logger *startupdiagnostics.ActivationDiagnosticsLogger,
	clock timeutil.Clock,
	err error,
) error {
	attributes := map[string]any{
		"error": "runtime adapter startup failed",
	}
	if err != nil {
		attributes["error"] = err.Error()
	}
	var adapterErr *RuntimeAdapterError
	if errors.As(err, &adapterErr) && adapterErr.RuntimeID != "" {
		for key, value := range RuntimeAdapterTimelineAttributes(adapterErr.RuntimeID) {
			attributes[key] = value
		}
	} else {
		for key, value := range TimelineAttributes("runtime-adapters", "Starting runtime adapter") {
			attributes[key] = value
		}
	}
	return RecordOperationPhaseFailure(logger, clock, "start_runtime_adapters", attributes)
}

func runtimeProcessFailureAttributes(processErr *process.ProcessManagerError) map[string]any {
	attributes := map[string]any{
		"error": processErr.Error(),
	}
	if processErr.ProcessKey != "" {
		attributes["processKey"] = processErr.ProcessKey
		for key, value := range RuntimeProcessTimelineAttributes(processErr.ProcessKey) {
			attributes[key] = value
		}
	}
	if processErr.ProcessIndex != nil {
		attributes["processIndex"] = uint64(*processErr.ProcessIndex)
	}
	switch processErr.Kind {
	case process.ProcessManagerStartProcessError:
		attributes["failureKind"] = "runtime_process_spawn_failed"
		addProcessOutputTailAttributes(attributes, processErr.ProcessOutputTails)
		if processErr.Cause != nil {
			attributes["error"] = processErr.Cause.Error()
		}
	case process.ProcessManagerReadinessCheckError:
		attributes["failureKind"] = "runtime_process_readiness_failed"
		if processErr.ReadinessFailure != nil {
			attributes["readinessType"] = processErr.ReadinessFailure.ReadinessType
			attributes["readinessTarget"] = processErr.ReadinessFailure.ReadinessTarget
			attributes["timeoutMs"] = processErr.ReadinessFailure.TimeoutMS
			addProcessOutputTailAttributes(attributes, processErr.ReadinessFailure.OutputTails)
		} else {
			addProcessOutputTailAttributes(attributes, processErr.ProcessOutputTails)
		}
		if processErr.Cause != nil {
			attributes["error"] = processErr.Cause.Error()
		}
	case process.ProcessManagerStopProcessesError:
		if processErr.Cause != nil {
			attributes["error"] = processErr.Cause.Error()
		}
	}
	return attributes
}

func addProcessOutputTailAttributes(attributes map[string]any, outputTails process.OutputTails) {
	attributes["stdoutCaptured"] = outputTails.StdoutCaptured
	attributes["stderrCaptured"] = outputTails.StderrCaptured
	if outputTails.StdoutTail != nil {
		attributes["stdoutTail"] = *outputTails.StdoutTail
	}
	if outputTails.StderrTail != nil {
		attributes["stderrTail"] = *outputTails.StderrTail
	}
}

func runtimePlanTimelineStep(step runtime.RuntimePlanApplyLifecycleStep) (string, string) {
	switch step {
	case runtime.RuntimePlanApplyLifecycleRuntimeArtifacts:
		return "runtime-artifacts", "Installing runtime artifacts"
	case runtime.RuntimePlanApplyLifecycleWorkspaceSources:
		return "workspace", "Preparing workspace"
	case runtime.RuntimePlanApplyLifecycleSkills:
		return "skills", "Reconciling skills"
	case runtime.RuntimePlanApplyLifecycleRuntimeFiles:
		return "runtime-files", "Writing runtime files"
	default:
		return "runtime-plan", "Applying runtime plan"
	}
}

func runtimePlanApplyFailureAttributes(applyErr *runtime.RuntimePlanApplyError) map[string]any {
	switch applyErr.Kind {
	case runtime.RuntimePlanApplyArtifactInstallError:
		attributes := TimelineAttributes("runtime-artifacts", "Installing runtime artifacts")
		attributes["failureKind"] = "artifact_install_failed"
		attributes["artifactKey"] = applyErr.ArtifactKey
		attributes["installIndex"] = uint64(applyErr.InstallIndex)
		attributes["installOp"] = string(applyErr.InstallOp)
		if applyErr.Cause != nil {
			attributes["error"] = applyErr.Cause.Error()
		}
		return attributes
	case runtime.RuntimePlanApplyWorkspaceSourceError:
		attributes := TimelineAttributes("workspace", "Preparing workspace")
		attributes["failureKind"] = "workspace_source_failed"
		attributes["sourceKind"] = string(applyErr.SourceKind)
		attributes["path"] = applyErr.Path
		attributes["originUrl"] = applyErr.OriginURL
		if applyErr.CloneURL != nil {
			attributes["cloneUrl"] = *applyErr.CloneURL
		}
		if applyErr.Cause != nil {
			attributes["error"] = applyErr.Cause.Error()
		}
		return attributes
	case runtime.RuntimePlanApplySkillsReconcileError:
		attributes := TimelineAttributes("skills", "Reconciling skills")
		attributes["failureKind"] = "skills_reconcile_failed"
		attributes["originUrl"] = applyErr.OriginURL
		attributes["runtimeId"] = applyErr.RuntimeID
		if applyErr.RepoPath != nil {
			attributes["repoPath"] = *applyErr.RepoPath
		}
		if applyErr.Cause != nil {
			attributes["error"] = applyErr.Cause.Error()
		}
		return attributes
	case runtime.RuntimePlanApplyRuntimeFileError:
		attributes := TimelineAttributes("runtime-files", "Writing runtime files")
		attributes["failureKind"] = "runtime_file_failed"
		attributes["clientId"] = applyErr.ClientID
		attributes["fileId"] = applyErr.FileID
		attributes["path"] = applyErr.Path
		if applyErr.Cause != nil {
			attributes["error"] = applyErr.Cause.Error()
		}
		return attributes
	default:
		return map[string]any{}
	}
}

type OperationTranscriptOutputSink struct {
	Logger *startupdiagnostics.ActivationDiagnosticsLogger
	Clock  timeutil.Clock
	Phase  string
}

func (sink OperationTranscriptOutputSink) RecordOutput(stream command.OutputStream, bytes []byte) {
	if sink.Logger == nil {
		return
	}
	transcriptStream := startupdiagnostics.ActivationTranscriptStdout
	if stream == command.OutputStreamStderr {
		transcriptStream = startupdiagnostics.ActivationTranscriptStderr
	}
	if err := sink.Logger.RecordTranscript(sink.Clock, &sink.Phase, transcriptStream, bytes); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to record activation diagnostics transcript: %v\n", err)
	}
}

func runtimeProcessTimelineLabel(processKey string) string {
	switch processKey {
	case "codex-app-server":
		return "Starting Codex app server"
	case "opencode-server":
		return "Starting OpenCode server"
	default:
		return "Starting " + processKey
	}
}

func runtimeAdapterTimelineLabel(runtimeID string) string {
	switch runtimeID {
	case "codex":
		return "Starting Codex adapter"
	case "opencode":
		return "Starting OpenCode adapter"
	case "pi":
		return "Starting Pi adapter"
	default:
		return "Starting " + runtimeID + " adapter"
	}
}
