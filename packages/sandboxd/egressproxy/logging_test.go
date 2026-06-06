package egressproxy

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/mistle/sandboxd/timeutil"
)

func TestSerializeLogLineIncludesBaseFieldsAndExtras(t *testing.T) {
	clock := timeutil.NewMutableClock(104)

	line, err := SerializeLogLine(clock, "sandbox-instance-a", "routeMatched", map[string]any{
		"egressRuleId": "egress-rule-a",
		"statusCode":   200,
	})
	requireNoError(t, err)

	var payload map[string]any
	if err := json.Unmarshal([]byte(line), &payload); err != nil {
		t.Fatalf("expected serialized JSON log line, got %v", err)
	}
	assertEqual(t, payload["event"].(string), "routeMatched")
	assertEqual(t, payload["sandboxInstanceId"].(string), "sandbox-instance-a")
	assertEqual(t, payload["component"].(string), "EgressProxy")
	assertEqual(t, payload["observedAt"].(string), "1970-01-01T00:00:00.104Z")
	assertEqual(t, payload["egressRuleId"].(string), "egress-rule-a")
	assertEqual(t, payload["statusCode"].(float64), 200)
}

func TestEmitLogWritesOneJsonLine(t *testing.T) {
	clock := timeutil.NewMutableClock(104)
	var output bytes.Buffer

	err := EmitLogTo(&output, clock, "sandbox-instance-a", "proxyStarted", map[string]any{"listenAddress": "127.0.0.1:18080"})
	requireNoError(t, err)

	lines := bytes.Split(bytes.TrimSpace(output.Bytes()), []byte("\n"))
	assertEqual(t, len(lines), 1)

	var payload map[string]any
	if err := json.Unmarshal(lines[0], &payload); err != nil {
		t.Fatalf("expected JSON log payload, got %v", err)
	}
	assertEqual(t, payload["event"].(string), "proxyStarted")
	assertEqual(t, payload["listenAddress"].(string), "127.0.0.1:18080")
}

func TestSerializeLogLineRequiresClock(t *testing.T) {
	_, err := SerializeLogLine(nil, "sandbox-instance-a", "proxyStarted", nil)
	if err == nil {
		t.Fatalf("expected missing clock to fail")
	}
	assertEqual(t, err.Error(), "egress proxy log clock is required")
}
