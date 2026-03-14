package tunnel

import "testing"

func TestParseCodexTurnStartRequest(t *testing.T) {
	t.Run("extracts the request and thread ids from a turn/start request", func(t *testing.T) {
		requestID, threadID, ok := parseCodexTurnStartRequest([]byte(
			`{"jsonrpc":"2.0","id":"req_123","method":"turn/start","params":{"threadId":"thread_123"}}`,
		))
		if !ok {
			t.Fatal("expected turn/start request to parse")
		}
		if requestID != "req_123" {
			t.Fatalf("expected request id req_123, got %q", requestID)
		}
		if threadID != "thread_123" {
			t.Fatalf("expected thread id thread_123, got %q", threadID)
		}
	})

	t.Run("rejects non-turn/start requests", func(t *testing.T) {
		_, _, ok := parseCodexTurnStartRequest([]byte(
			`{"jsonrpc":"2.0","id":"req_123","method":"thread/read","params":{"threadId":"thread_123"}}`,
		))
		if ok {
			t.Fatal("expected non-turn/start request to be rejected")
		}
	})
}

func TestParseCodexTurnStartResponse(t *testing.T) {
	t.Run("extracts the request and turn ids from a turn/start response", func(t *testing.T) {
		requestID, turnID, ok := parseCodexTurnStartResponse([]byte(
			`{"jsonrpc":"2.0","id":"req_123","result":{"turn":{"id":"turn_123"}}}`,
		))
		if !ok {
			t.Fatal("expected turn/start response to parse")
		}
		if requestID != "req_123" {
			t.Fatalf("expected request id req_123, got %q", requestID)
		}
		if turnID != "turn_123" {
			t.Fatalf("expected turn id turn_123, got %q", turnID)
		}
	})

	t.Run("rejects responses without a turn id", func(t *testing.T) {
		_, _, ok := parseCodexTurnStartResponse([]byte(
			`{"jsonrpc":"2.0","id":"req_123","result":{"turn":{"id":""}}}`,
		))
		if ok {
			t.Fatal("expected response without a turn id to be rejected")
		}
	})
}

func TestParseCodexTurnCompletedNotification(t *testing.T) {
	turnID, ok := parseCodexTurnCompletedNotification([]byte(
		`{"jsonrpc":"2.0","method":"turn/completed","params":{"turn":{"id":"turn_123"}}}`,
	))
	if !ok {
		t.Fatal("expected turn/completed notification to parse")
	}
	if turnID != "turn_123" {
		t.Fatalf("expected turn id turn_123, got %q", turnID)
	}
}

func TestParseCodexThreadReadTurnInProgress(t *testing.T) {
	t.Run("returns true when the target turn is still in progress", func(t *testing.T) {
		inProgress, err := parseCodexThreadReadTurnInProgress([]byte(
			`{"thread":{"turns":[{"id":"turn_123","status":"inProgress"},{"id":"turn_456","status":"completed"}]}}`,
		), "turn_123")
		if err != nil {
			t.Fatalf("expected thread/read payload to parse: %v", err)
		}
		if !inProgress {
			t.Fatal("expected turn_123 to be in progress")
		}
	})

	t.Run("returns false when the target turn is missing", func(t *testing.T) {
		inProgress, err := parseCodexThreadReadTurnInProgress([]byte(
			`{"thread":{"turns":[{"id":"turn_456","status":"completed"}]}}`,
		), "turn_123")
		if err != nil {
			t.Fatalf("expected thread/read payload to parse: %v", err)
		}
		if inProgress {
			t.Fatal("expected missing turn to be treated as not in progress")
		}
	})
}
