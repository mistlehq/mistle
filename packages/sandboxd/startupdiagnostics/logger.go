package startupdiagnostics

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/timeutil"
)

const (
	ActivateLogPath = "/run/mistle/activate.log"
	TestLogDirEnv   = "MISTLE_SANDBOXD_OPERATION_LOG_DIR"
)

type ActivationDiagnosticLevel string

const (
	ActivationDiagnosticLevelInfo  ActivationDiagnosticLevel = "info"
	ActivationDiagnosticLevelError ActivationDiagnosticLevel = "error"
)

type ActivationTranscriptStream string

const (
	ActivationTranscriptStdout ActivationTranscriptStream = "stdout"
	ActivationTranscriptStderr ActivationTranscriptStream = "stderr"
	ActivationTranscriptSystem ActivationTranscriptStream = "system"
)

type ActivationDiagnosticsLogger struct {
	sandboxInstanceID string
	operation         ActivationOperation
	path              string
}

func InitializeActivationDiagnosticsLogger(operation ActivationOperation, tunnelGatewayWebSocketURL string) (ActivationDiagnosticsLogger, error) {
	if _, err := activationOperationEventPrefix(operation); err != nil {
		return ActivationDiagnosticsLogger{}, err
	}
	sandboxInstanceID, err := DeriveSandboxInstanceID(tunnelGatewayWebSocketURL)
	if err != nil {
		return ActivationDiagnosticsLogger{}, fmt.Errorf("failed to derive sandbox instance id: %w", err)
	}
	path, err := OperationLogPath(operation)
	if err != nil {
		return ActivationDiagnosticsLogger{}, err
	}
	parent := filepath.Dir(path)
	if parent == "." || parent == "" {
		return ActivationDiagnosticsLogger{}, fmt.Errorf("startup operation log path %s has no parent", path)
	}
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return ActivationDiagnosticsLogger{}, fmt.Errorf("failed to create startup operation log directory %s: %w", parent, err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return ActivationDiagnosticsLogger{}, fmt.Errorf("failed to initialize startup operation log %s: %w", path, err)
	}
	if err := file.Close(); err != nil {
		return ActivationDiagnosticsLogger{}, fmt.Errorf("failed to close initialized startup operation log %s: %w", path, err)
	}

	return ActivationDiagnosticsLogger{
		sandboxInstanceID: sandboxInstanceID,
		operation:         operation,
		path:              path,
	}, nil
}

func (logger ActivationDiagnosticsLogger) RecordStarted(clock timeutil.Clock) error {
	eventNames, err := operationEventNames(logger.operation)
	if err != nil {
		return err
	}
	return logger.RecordWithClock(clock, ActivationDiagnosticLevelInfo, eventNames.Started, nil)
}

func (logger ActivationDiagnosticsLogger) RecordPhaseStarted(clock timeutil.Clock, phase string) error {
	return logger.RecordPhaseStartedWithAttributes(clock, phase, nil)
}

func (logger ActivationDiagnosticsLogger) RecordPhaseStartedWithAttributes(clock timeutil.Clock, phase string, attributes map[string]any) error {
	eventNames, err := operationEventNames(logger.operation)
	if err != nil {
		return err
	}
	payloadAttributes := cloneMap(attributes)
	payloadAttributes["phase"] = phase
	return logger.RecordWithClock(clock, ActivationDiagnosticLevelInfo, eventNames.PhaseStarted, payloadAttributes)
}

func (logger ActivationDiagnosticsLogger) RecordPhaseCompleted(clock timeutil.Clock, phase string) error {
	return logger.RecordPhaseCompletedWithAttributes(clock, phase, nil)
}

func (logger ActivationDiagnosticsLogger) RecordPhaseCompletedWithAttributes(clock timeutil.Clock, phase string, attributes map[string]any) error {
	eventNames, err := operationEventNames(logger.operation)
	if err != nil {
		return err
	}
	payloadAttributes := cloneMap(attributes)
	payloadAttributes["phase"] = phase
	return logger.RecordWithClock(clock, ActivationDiagnosticLevelInfo, eventNames.PhaseCompleted, payloadAttributes)
}

func (logger ActivationDiagnosticsLogger) RecordPhaseFailed(clock timeutil.Clock, phase string, attributes map[string]any) error {
	eventNames, err := operationEventNames(logger.operation)
	if err != nil {
		return err
	}
	payloadAttributes := cloneMap(attributes)
	payloadAttributes["phase"] = phase
	return logger.RecordWithClock(clock, ActivationDiagnosticLevelError, eventNames.PhaseFailed, payloadAttributes)
}

func (logger ActivationDiagnosticsLogger) RecordTranscript(clock timeutil.Clock, phase *string, stream ActivationTranscriptStream, payload []byte) error {
	eventNames, err := operationEventNames(logger.operation)
	if err != nil {
		return err
	}
	attributes := map[string]any{
		"stream":        string(stream),
		"message":       string(payload),
		"payloadBase64": base64.StdEncoding.EncodeToString(payload),
	}
	if phase != nil {
		attributes["phase"] = *phase
	}
	return logger.RecordWithClock(clock, ActivationDiagnosticLevelInfo, eventNames.Transcript, attributes)
}

func (logger ActivationDiagnosticsLogger) RecordWithClock(clock timeutil.Clock, level ActivationDiagnosticLevel, event string, attributes map[string]any) error {
	if clock == nil {
		return fmt.Errorf("startup diagnostics clock is required")
	}
	operationName, err := operationString(logger.operation)
	if err != nil {
		return err
	}
	operationKind, err := operationKindString(logger.operation.OperationKind)
	if err != nil {
		return err
	}
	timestamp := timeutil.FormatRFC3339Timestamp(clock.NowSystemTime())
	payload := map[string]any{
		"timestamp":         timestamp,
		"level":             string(level),
		"event":             event,
		"sandboxInstanceId": logger.sandboxInstanceID,
		"operation":         operationName,
		"operationKind":     operationKind,
	}
	for key, value := range attributes {
		payload[key] = value
	}

	line, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to serialize startup diagnostic event: %w", err)
	}
	file, err := os.OpenFile(logger.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("failed to open startup diagnostic log %s for append: %w", logger.path, err)
	}
	defer file.Close()
	if _, err := file.Write(append(line, '\n')); err != nil {
		return fmt.Errorf("failed to append startup diagnostic log %s: %w", logger.path, err)
	}

	return nil
}

func DeriveSandboxInstanceID(gatewayWebSocketURL string) (string, error) {
	parsedURL, err := url.Parse(gatewayWebSocketURL)
	if err != nil {
		return "", fmt.Errorf("invalid gateway url: %w", err)
	}
	pathSegments := stringsSplitNonEmpty(parsedURL.Path, "/")
	if len(pathSegments) == 0 {
		return "", fmt.Errorf("invalid gateway url: tunnel gateway url must end with the sandbox instance id path segment")
	}
	return pathSegments[len(pathSegments)-1], nil
}

func OperationLogPath(operation ActivationOperation) (string, error) {
	fileName, err := operationLogFileName(operation)
	if err != nil {
		return "", err
	}
	if testLogDir := os.Getenv(TestLogDirEnv); testLogDir != "" {
		return filepath.Join(testLogDir, fileName), nil
	}
	return ActivateLogPath, nil
}

func operationLogFileName(operation ActivationOperation) (string, error) {
	switch operation.OperationKind {
	case protocol.ActivationOperationStart, protocol.ActivationOperationResume, protocol.ActivationOperationSetupCheck, protocol.ActivationOperationSnapshot:
		return "activate.log", nil
	default:
		return "", fmt.Errorf("unsupported activation operation kind: %s", operation.OperationKind)
	}
}

func operationString(operation ActivationOperation) (string, error) {
	if _, err := activationOperationEventPrefix(operation); err != nil {
		return "", err
	}
	return "activate", nil
}

func operationKindString(kind protocol.ActivationOperationKind) (string, error) {
	switch kind {
	case protocol.ActivationOperationStart, protocol.ActivationOperationResume, protocol.ActivationOperationSetupCheck, protocol.ActivationOperationSnapshot:
		return string(kind), nil
	default:
		return "", fmt.Errorf("unsupported activation operation kind: %s", kind)
	}
}

func cloneMap(source map[string]any) map[string]any {
	target := make(map[string]any, len(source))
	for key, value := range source {
		target[key] = value
	}
	return target
}

func stringsSplitNonEmpty(value string, separator string) []string {
	parts := make([]string, 0)
	for _, part := range strings.Split(value, separator) {
		if part != "" {
			parts = append(parts, part)
		}
	}
	return parts
}
