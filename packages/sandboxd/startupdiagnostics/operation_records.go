package startupdiagnostics

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mistle/sandboxd/protocol"
)

type ActivationOperation struct {
	OperationKind protocol.ActivationOperationKind
}

func OperationRecordLine(operation ActivationOperation, observedAt string, event string, payload map[string]any) (*string, error) {
	eventNames, err := operationEventNames(operation)
	if err != nil {
		return nil, err
	}
	var record map[string]any
	switch {
	case event == eventNames.Started, event == eventNames.Failed:
		return nil, nil
	case event == eventNames.PhaseStarted:
		phase, ok := operationRecordPhase(payload)
		if !ok {
			return nil, nil
		}
		record = lifecycleOperationRecord(observedAt, phase, "started", payload)
	case event == eventNames.PhaseCompleted:
		phase, ok := operationRecordPhase(payload)
		if !ok {
			return nil, nil
		}
		record = lifecycleOperationRecord(observedAt, phase, "completed", payload)
	case event == eventNames.PhaseFailed:
		phase, ok := operationRecordPhase(payload)
		if !ok {
			return nil, nil
		}
		record = lifecycleOperationRecord(observedAt, phase, "failed", payload)
	case event == eventNames.Transcript:
		record = map[string]any{
			"kind":          "transcript",
			"observedAt":    observedAt,
			"phase":         optionalOperationLifecyclePhase(payload),
			"source":        "sandboxd",
			"stream":        stringValue(payload, "stream", "system"),
			"payloadBase64": stringValue(payload, "payloadBase64", ""),
		}
	default:
		return nil, nil
	}

	serialized, err := json.Marshal(record)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize operation record: %w", err)
	}
	line := string(serialized) + "\n"
	return &line, nil
}

func OperationLifecyclePhase(phase string) (string, bool) {
	switch phase {
	case "apply_git_identity":
		return "git_identity", true
	case "attach_runtime_agent_endpoint":
		return "agent_endpoint", true
	case "apply_runtime_plan":
		return "runtime_plan", true
	case "run_setup_script":
		return "setup_script", true
	case "start_egress_proxy":
		return "egress", true
	case "start_runtime_adapters":
		return "runtime_adapters", true
	case "start_runtime_processes":
		return "runtime_processes", true
	case "start_tunnel_session", "stop_tunnel_session", "attach_runtime_environment":
		return "operation_stream", true
	case "ready":
		return "ready", true
	default:
		if strings.HasPrefix(phase, "stop_tunnel_session_") {
			return "operation_stream", true
		}
		if strings.HasPrefix(phase, "stop_egress_proxy") {
			return "teardown", true
		}
		return "", false
	}
}

func LifecycleAttributes(payload map[string]any) map[string]any {
	attributes := make(map[string]any)
	for key, value := range payload {
		switch key {
		case "timestamp", "level", "event", "sandboxInstanceId", "operation":
			continue
		default:
			attributes[key] = value
		}
	}
	return attributes
}

func lifecycleOperationRecord(observedAt string, phase string, status string, payload map[string]any) map[string]any {
	return map[string]any{
		"kind":       "lifecycle",
		"observedAt": observedAt,
		"phase":      phase,
		"status":     status,
		"source":     "sandboxd",
		"message":    fmt.Sprintf("%s %s", phase, status),
		"attributes": LifecycleAttributes(payload),
	}
}

func operationRecordPhase(payload map[string]any) (string, bool) {
	rawPhase, ok := payload["phase"].(string)
	if !ok {
		return "", false
	}
	return OperationLifecyclePhase(rawPhase)
}

func optionalOperationLifecyclePhase(payload map[string]any) any {
	rawPhase, ok := payload["phase"].(string)
	if !ok {
		return nil
	}
	phase, ok := OperationLifecyclePhase(rawPhase)
	if !ok {
		return nil
	}
	return phase
}

func stringValue(payload map[string]any, key string, defaultValue string) string {
	value, ok := payload[key].(string)
	if !ok {
		return defaultValue
	}
	return value
}

type activationOperationEventNames struct {
	Started        string
	PhaseStarted   string
	PhaseCompleted string
	PhaseFailed    string
	Failed         string
	Transcript     string
}

func operationEventNames(operation ActivationOperation) (activationOperationEventNames, error) {
	prefix, err := activationOperationEventPrefix(operation)
	if err != nil {
		return activationOperationEventNames{}, err
	}
	return activationOperationEventNames{
		Started:        prefix + "_started",
		PhaseStarted:   prefix + "_phase_started",
		PhaseCompleted: prefix + "_phase_completed",
		PhaseFailed:    prefix + "_phase_failed",
		Failed:         prefix + "_failed",
		Transcript:     prefix + "_transcript",
	}, nil
}

func activationOperationEventPrefix(operation ActivationOperation) (string, error) {
	switch operation.OperationKind {
	case protocol.ActivationOperationStart:
		return "sandbox_start", nil
	case protocol.ActivationOperationResume:
		return "sandbox_resume", nil
	case protocol.ActivationOperationSetupCheck:
		return "sandbox_setup_check", nil
	case protocol.ActivationOperationSnapshot:
		return "sandbox_snapshot", nil
	default:
		return "", fmt.Errorf("unsupported activation operation kind: %s", operation.OperationKind)
	}
}
