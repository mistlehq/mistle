package supervision

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEncodeForwardedLifecycleEventLogLineAddsTimestampAndLevel(t *testing.T) {
	line, err := EncodeForwardedLifecycleEventLogLine(`{"event":"component_healthcheck_failed","observedAt":"2026-01-02T03:04:05Z","component":"EgressProxy","probeKind":"loopback_tcp"}`)
	requireNoError(t, err)

	payload := decodeForwardedLifecycleLine(t, line)
	assertEqual(t, payload["timestamp"].(string), "2026-01-02T03:04:05Z")
	assertEqual(t, payload["level"].(string), "warn")
	assertEqual(t, payload["event"].(string), "component_healthcheck_failed")
	assertEqual(t, payload["observedAt"].(string), "2026-01-02T03:04:05Z")
	assertEqual(t, payload["component"].(string), "EgressProxy")
	assertEqual(t, payload["probeKind"].(string), "loopback_tcp")
	if !strings.HasSuffix(line, "\n") {
		t.Fatalf("expected forwarded lifecycle line to end with newline")
	}
}

func TestEncodeForwardedLifecycleEventLogLineMapsLifecycleLevels(t *testing.T) {
	cases := []struct {
		event string
		level string
	}{
		{event: "component_starting", level: "info"},
		{event: "component_started", level: "info"},
		{event: "component_restart_succeeded", level: "info"},
		{event: "daemon_liveness_recovered", level: "info"},
		{event: "component_healthcheck_failed", level: "warn"},
		{event: "component_restart_scheduled", level: "warn"},
		{event: "daemon_liveness_lag_detected", level: "warn"},
		{event: "component_exited", level: "error"},
	}

	for _, tc := range cases {
		line, err := EncodeForwardedLifecycleEventLogLine(`{"event":"` + tc.event + `","observedAt":"2026-01-02T03:04:05Z"}`)
		requireNoError(t, err)
		payload := decodeForwardedLifecycleLine(t, line)
		assertEqual(t, payload["level"].(string), tc.level)
	}
}

func TestEncodeForwardedLifecycleEventLogLineRejectsInvalidInput(t *testing.T) {
	cases := []struct {
		input string
		error string
	}{
		{input: `not-json`, error: "invalid lifecycle event json"},
		{input: `[]`, error: "invalid lifecycle event json"},
		{input: `{"event":"component_started"}`, error: "lifecycle event line is missing observedAt"},
		{input: `{"observedAt":"2026-01-02T03:04:05Z"}`, error: "lifecycle event line is missing event"},
		{input: `{"event":"future_event","observedAt":"2026-01-02T03:04:05Z"}`, error: "unsupported lifecycle event \"future_event\" cannot be forwarded"},
	}

	for _, tc := range cases {
		_, err := EncodeForwardedLifecycleEventLogLine(tc.input)
		if err == nil {
			t.Fatalf("expected %s to fail", tc.input)
		}
		if !strings.Contains(err.Error(), tc.error) {
			t.Fatalf("expected error containing %q, got %v", tc.error, err)
		}
	}
}

func decodeForwardedLifecycleLine(t *testing.T, line string) map[string]any {
	t.Helper()
	var payload map[string]any
	requireNoError(t, json.Unmarshal([]byte(line), &payload))
	return payload
}
