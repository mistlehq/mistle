package sandboxdstate

import (
	"errors"
	"fmt"

	"github.com/mistle/sandboxd/command"
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
	return errors.Join(
		logger.RecordPhaseStartedWithAttributes(clock, phase, attributes),
		logger.RecordTranscript(clock, &phase, startupdiagnostics.ActivationTranscriptSystem, []byte(phase+" started")),
	)
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
	return errors.Join(
		logger.RecordPhaseCompletedWithAttributes(clock, phase, attributes),
		logger.RecordTranscript(clock, &phase, startupdiagnostics.ActivationTranscriptSystem, []byte(phase+" completed")),
	)
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
	return errors.Join(
		logger.RecordPhaseFailed(clock, phase, attributes),
		logger.RecordTranscript(clock, &phase, startupdiagnostics.ActivationTranscriptSystem, []byte(transcriptMessage)),
	)
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
