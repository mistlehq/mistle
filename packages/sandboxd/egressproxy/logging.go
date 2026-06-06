package egressproxy

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

type LogContext struct {
	Clock             timeutil.Clock
	SandboxInstanceID string
}

func EmitLog(clock timeutil.Clock, sandboxInstanceID string, event string, extraFields map[string]any) error {
	return EmitLogTo(os.Stderr, clock, sandboxInstanceID, event, extraFields)
}

func EmitLogTo(writer io.Writer, clock timeutil.Clock, sandboxInstanceID string, event string, extraFields map[string]any) error {
	line, err := SerializeLogLine(clock, sandboxInstanceID, event, extraFields)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintln(writer, line); err != nil {
		return fmt.Errorf("failed to write egress proxy log line: %w", err)
	}
	return nil
}

func SerializeLogLine(clock timeutil.Clock, sandboxInstanceID string, event string, extraFields map[string]any) (string, error) {
	if clock == nil {
		return "", fmt.Errorf("egress proxy log clock is required")
	}

	payload := map[string]any{
		"event":             event,
		"sandboxInstanceId": sandboxInstanceID,
		"component":         string(supervision.ComponentEgressProxy),
		"observedAt":        timeutil.FormatRFC3339Timestamp(clock.NowSystemTime()),
	}
	for fieldName, fieldValue := range extraFields {
		payload[fieldName] = fieldValue
	}

	serialized, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("failed to serialize egress proxy log line: %w", err)
	}
	return string(serialized), nil
}
