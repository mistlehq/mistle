package protocol

import "testing"

func TestProcessesSnapshotPayloadMatchesTunnelContract(t *testing.T) {
	command := "node server.js"
	payload, err := ProcessesSnapshotPayload(ProcessesSnapshot{
		MessageType: "processes.snapshot",
		ObservedAt:  "2025-04-10T12:00:00Z",
		Processes: []ProcessEntry{
			{
				PID:     1234,
				Command: &command,
				Listeners: []ProcessListener{
					{Port: 3000, BindAddress: "127.0.0.1"},
				},
			},
		},
	})
	requireNoError(t, err)

	assertEqual(t, payload, `{"type":"processes.snapshot","observedAt":"2025-04-10T12:00:00Z","processes":[{"pid":1234,"command":"node server.js","listeners":[{"port":3000,"bindAddress":"127.0.0.1"}]}]}`)
}

func TestParseProcessesStreamMessages(t *testing.T) {
	refresh, err := ParseProcessesStreamMessage(`{"type":"processes.refresh"}`)
	requireNoError(t, err)
	if refresh.Refresh == nil {
		t.Fatalf("expected processes refresh")
	}

	snapshot, err := ParseProcessesStreamMessage(`{"type":"processes.snapshot","observedAt":"2025-04-10T12:00:00Z","processes":[]}`)
	requireNoError(t, err)
	if snapshot.Snapshot == nil {
		t.Fatalf("expected processes snapshot")
	}
	assertEqual(t, snapshot.Snapshot.ObservedAt, "2025-04-10T12:00:00Z")
}

func TestParseProcessesStreamMessageRejectsUnsupportedPayloads(t *testing.T) {
	_, malformedErr := ParseProcessesStreamMessage(`{`)
	if malformedErr == nil {
		t.Fatalf("expected malformed json error")
	}
	_, unsupportedErr := ParseProcessesStreamMessage(`{"type":"processes.unknown"}`)
	if unsupportedErr == nil {
		t.Fatalf("expected unsupported message error")
	}
	assertEqual(t, unsupportedErr.Error(), `unsupported processes stream message type "processes.unknown"`)
}
