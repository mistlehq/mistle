package supervision

import (
	"encoding/json"
	"fmt"
)

type LifecycleEventLevel string

const (
	LifecycleEventLevelInfo  LifecycleEventLevel = "info"
	LifecycleEventLevelWarn  LifecycleEventLevel = "warn"
	LifecycleEventLevelError LifecycleEventLevel = "error"
)

func EncodeForwardedLifecycleEventLogLine(rawLine string) (string, error) {
	var parsed map[string]any
	if err := json.Unmarshal([]byte(rawLine), &parsed); err != nil {
		return "", fmt.Errorf("invalid lifecycle event json: %w", err)
	}
	observedAt, ok := parsed["observedAt"].(string)
	if !ok {
		return "", fmt.Errorf("lifecycle event line is missing observedAt")
	}
	rawEvent, ok := parsed["event"].(string)
	if !ok {
		return "", fmt.Errorf("lifecycle event line is missing event")
	}

	level, err := lifecycleEventForwardingLevel(LifecycleEventName(rawEvent))
	if err != nil {
		return "", err
	}

	payload := map[string]any{
		"timestamp": observedAt,
		"level":     string(level),
		"event":     rawEvent,
	}
	for fieldName, fieldValue := range parsed {
		if fieldName == "event" {
			continue
		}
		payload[fieldName] = fieldValue
	}

	serialized, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(serialized) + "\n", nil
}

func lifecycleEventForwardingLevel(event LifecycleEventName) (LifecycleEventLevel, error) {
	switch event {
	case LifecycleEventComponentStarting,
		LifecycleEventComponentStarted,
		LifecycleEventComponentRestartSucceeded,
		LifecycleEventDaemonLivenessRecovered:
		return LifecycleEventLevelInfo, nil
	case LifecycleEventComponentHealthcheckFailed,
		LifecycleEventComponentRestartScheduled,
		LifecycleEventDaemonLivenessLagDetected:
		return LifecycleEventLevelWarn, nil
	case LifecycleEventComponentExited:
		return LifecycleEventLevelError, nil
	default:
		return "", fmt.Errorf("unsupported lifecycle event %q cannot be forwarded", string(event))
	}
}
