package protocol

import "testing"

func TestParseStreamControlMessageAcceptsRuntimeChannelOpens(t *testing.T) {
	agent, err := ParseStreamControlMessage(`{"type":"stream.open","streamId":7,"channel":{"kind":"agent"}}`)
	requireNoError(t, err)
	if agent.Open == nil || agent.Open.Channel.Kind != "agent" {
		t.Fatalf("expected agent stream.open")
	}

	processes, err := ParseStreamControlMessage(`{"type":"stream.open","streamId":11,"channel":{"kind":"processes"}}`)
	requireNoError(t, err)
	if processes.Open == nil || processes.Open.Channel.Kind != "processes" {
		t.Fatalf("expected processes stream.open")
	}

	upload, err := ParseStreamControlMessage(`{"type":"stream.open","streamId":7,"channel":{"kind":"fileUpload","threadId":"thread_123","mimeType":"image/png","originalFilename":"image.png","sizeBytes":8}}`)
	requireNoError(t, err)
	if upload.Open == nil || upload.Open.Channel.Kind != "fileUpload" {
		t.Fatalf("expected fileUpload stream.open")
	}

	execOpen, err := ParseStreamControlMessage(`{"type":"stream.open","streamId":8,"channel":{"kind":"exec","command":"git","args":["status","--short"],"cwd":"/workspace/repo","stdin":"prompt text","timeoutMs":15000,"maxOutputBytes":65536}}`)
	requireNoError(t, err)
	if execOpen.Open == nil || execOpen.Open.Channel.Kind != "exec" {
		t.Fatalf("expected exec stream.open")
	}
	assertEqual(t, execOpen.Open.Channel.Command, "git")
	if execOpen.Open.Channel.CWD == nil {
		t.Fatalf("expected exec cwd")
	}
	assertEqual(t, *execOpen.Open.Channel.CWD, "/workspace/repo")

	fileSearch, err := ParseStreamControlMessage(`{"type":"stream.open","streamId":31,"channel":{"kind":"fileSearch","cwd":"/workspace/repo"}}`)
	requireNoError(t, err)
	if fileSearch.Open == nil || fileSearch.Open.Channel.Kind != "fileSearch" {
		t.Fatalf("expected fileSearch stream.open")
	}
}

func TestParseStreamControlMessageIgnoresUnknownFields(t *testing.T) {
	streamOpen, err := ParseStreamControlMessage(`{"type":"stream.open","streamId":8,"ignored":true,"channel":{"kind":"exec","command":"git","args":["status"],"cwd":"/workspace/repo","ignored":true}}`)
	requireNoError(t, err)
	if streamOpen.Open == nil {
		t.Fatalf("expected stream.open")
	}
	assertEqual(t, streamOpen.Open.StreamID, uint32(8))
	assertEqual(t, streamOpen.Open.Channel.Command, "git")
	if streamOpen.Open.Channel.CWD == nil {
		t.Fatalf("expected exec cwd")
	}
	assertEqual(t, *streamOpen.Open.Channel.CWD, "/workspace/repo")

	streamSignal, err := ParseStreamControlMessage(`{"type":"stream.signal","streamId":9,"ignored":true,"signal":{"type":"pty.resize","cols":120,"rows":40,"ignored":true}}`)
	requireNoError(t, err)
	if streamSignal.Signal == nil {
		t.Fatalf("expected stream.signal")
	}

	ptySignal, err := ParsePTYControlMessage(`{"type":"stream.signal","streamId":9,"ignored":true,"signal":{"type":"pty.resize","cols":120,"rows":40,"ignored":true}}`)
	requireNoError(t, err)
	if ptySignal.Signal == nil {
		t.Fatalf("expected pty stream.signal")
	}
	assertEqual(t, ptySignal.Signal.Signal.Cols, uint16(120))
	assertEqual(t, ptySignal.Signal.Signal.Rows, uint16(40))
}

func TestStreamResponsePayloadsMatchTunnelContract(t *testing.T) {
	openOK, err := StreamOpenOK(7)
	requireNoError(t, err)
	assertEqual(t, openOK, `{"streamId":7,"type":"stream.open.ok"}`)

	openError, err := StreamOpenError(7, "invalid_connect_request", "bad request")
	requireNoError(t, err)
	assertEqual(t, openError, `{"code":"invalid_connect_request","message":"bad request","streamId":7,"type":"stream.open.error"}`)

	reset, err := StreamReset(7, "target_closed", "target closed stream")
	requireNoError(t, err)
	assertEqual(t, reset, `{"code":"target_closed","message":"target closed stream","streamId":7,"type":"stream.reset"}`)

	window, err := StreamWindowCredit(7, 128)
	requireNoError(t, err)
	assertEqual(t, window, `{"bytes":128,"streamId":7,"type":"stream.window"}`)

	complete, err := StreamComplete(7)
	requireNoError(t, err)
	assertEqual(t, complete, `{"streamId":7,"type":"stream.complete"}`)

	execResult, err := ExecResultEvent(9, 0, "stdout", "stderr", true)
	requireNoError(t, err)
	assertEqual(t, execResult, `{"event":{"exitCode":0,"stderr":"stderr","stdout":"stdout","truncated":true,"type":"exec.result"},"streamId":9,"type":"stream.event"}`)

	uploadCompleted, err := FileUploadCompletedEvent(7, "image", "att_123", "thread_123", "image.png", "image/png", 8, "/root/.local/attachments/thread_123/file.png")
	requireNoError(t, err)
	assertEqual(t, uploadCompleted, `{"event":{"attachmentId":"att_123","kind":"image","mimeType":"image/png","originalFilename":"image.png","path":"/root/.local/attachments/thread_123/file.png","sizeBytes":8,"threadId":"thread_123","type":"fileUpload.completed"},"streamId":7,"type":"stream.event"}`)
}
