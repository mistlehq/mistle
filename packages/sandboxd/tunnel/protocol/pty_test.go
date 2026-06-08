package protocol

import "testing"

func TestPTYSessionControlMessagesMatchTunnelContract(t *testing.T) {
	opened, err := PTYSessionOpenedPayload("pty_req_1", "pty_123")
	requireNoError(t, err)
	assertEqual(t, opened, `{"ptySessionId":"pty_123","requestId":"pty_req_1","type":"pty.session.opened"}`)

	failure, err := PTYSessionErrorPayload("pty_req_2", "pty_456", "pty_create_failed", "failed")
	requireNoError(t, err)
	assertEqual(t, failure, `{"code":"pty_create_failed","message":"failed","ptySessionId":"pty_456","requestId":"pty_req_2","type":"pty.session.error"}`)

	exit, err := PTYExitEvent(1, 7)
	requireNoError(t, err)
	assertEqual(t, exit, `{"event":{"exitCode":7,"type":"pty.exit"},"streamId":1,"type":"stream.event"}`)
}

func TestParsePTYSessionOpenControlMessage(t *testing.T) {
	message, err := ParsePTYSessionControlMessage(`{"type":"pty.session.open","requestId":"pty_req_1","ptySessionId":"pty_123","transportUrl":"ws://127.0.0.1/pty","transportToken":"token","launch":{"session":"create","cols":120,"rows":40,"command":"/bin/sh","args":["-lc","echo ok"]}}`)
	requireNoError(t, err)

	if message == nil || message.Open == nil {
		t.Fatalf("expected pty session open message")
	}
	assertEqual(t, message.Open.RequestID, "pty_req_1")
	assertEqual(t, message.Open.PTYSessionID, "pty_123")
	assertEqual(t, message.Open.Launch.Session, "create")
	if message.Open.Launch.Cols == nil || message.Open.Launch.Rows == nil {
		t.Fatalf("expected pty dimensions")
	}
	assertEqual(t, *message.Open.Launch.Cols, uint16(120))
	assertEqual(t, *message.Open.Launch.Rows, uint16(40))
}

func TestParsePTYControlMessageAcceptsResizeAndClose(t *testing.T) {
	signal, err := ParsePTYControlMessage(`{"type":"stream.signal","streamId":1,"signal":{"type":"pty.resize","cols":100,"rows":30}}`)
	requireNoError(t, err)
	if signal.Signal == nil {
		t.Fatalf("expected pty resize signal")
	}
	assertEqual(t, signal.Signal.Signal.Cols, uint16(100))
	assertEqual(t, signal.Signal.Signal.Rows, uint16(30))

	closeMessage, err := ParsePTYControlMessage(`{"type":"stream.close","streamId":1}`)
	requireNoError(t, err)
	if closeMessage.Close == nil {
		t.Fatalf("expected pty close")
	}
}

func TestParsePTYSessionControlMessageRejectsInvalidPayloads(t *testing.T) {
	for _, input := range []struct {
		name     string
		payload  string
		expected string
	}{
		{
			name:     "invalid transport url",
			payload:  `{"type":"pty.session.open","requestId":"pty_req_1","ptySessionId":"pty_123","transportUrl":"https://gateway.example.test/pty","transportToken":"jwt-token","launch":{"session":"create"}}`,
			expected: "pty.session.open transportUrl must use ws or wss",
		},
		{
			name:     "missing transport token",
			payload:  `{"type":"pty.session.open","requestId":"pty_req_1","ptySessionId":"pty_123","transportUrl":"wss://gateway.example.test/pty","transportToken":" ","launch":{"session":"create"}}`,
			expected: "pty.session.open transportToken is required",
		},
		{
			name:     "partial dimensions",
			payload:  `{"type":"pty.session.open","requestId":"pty_req_1","ptySessionId":"pty_123","transportUrl":"wss://gateway.example.test/pty","transportToken":"jwt-token","launch":{"session":"create","cols":120}}`,
			expected: "pty.session.open launch cols and rows must both be provided when either is set",
		},
		{
			name:     "empty arg",
			payload:  `{"type":"pty.session.open","requestId":"pty_req_1","ptySessionId":"pty_123","transportUrl":"wss://gateway.example.test/pty","transportToken":"jwt-token","launch":{"session":"create","args":["ok"," "]}}`,
			expected: "pty.session.open launch args must contain only non-empty strings",
		},
		{
			name:     "invalid error code",
			payload:  `{"type":"pty.session.error","requestId":"pty_req_1","ptySessionId":"pty_123","code":"not_in_contract","message":"Nope."}`,
			expected: "pty.session.error code is invalid",
		},
		{
			name:     "empty opened request id",
			payload:  `{"type":"pty.session.opened","requestId":"","ptySessionId":"pty_123"}`,
			expected: "pty.session.opened requestId is required",
		},
	} {
		t.Run(input.name, func(t *testing.T) {
			_, err := ParsePTYSessionControlMessage(input.payload)

			if err == nil {
				t.Fatalf("expected parse error")
			}
			if len(err.Error()) < len(input.expected) || err.Error()[:len(input.expected)] != input.expected {
				t.Fatalf("expected error prefix %q, got %q", input.expected, err.Error())
			}
		})
	}
}
