package process

import (
	"io"
	"strings"
	"testing"
)

func TestTailBufferKeepsOnlyRecentBytes(t *testing.T) {
	buffer := NewTailBuffer(5)

	buffer.Append([]byte("hello"))
	buffer.Append([]byte(" world"))

	snapshot := buffer.Snapshot()
	if snapshot == nil {
		t.Fatalf("expected tail snapshot")
	}
	assertEqual(t, *snapshot, "world")
}

func TestTailBufferReturnsNilWhenEmpty(t *testing.T) {
	buffer := NewTailBuffer(5)

	snapshot := buffer.Snapshot()

	if snapshot != nil {
		t.Fatalf("expected empty tail buffer to return nil, got %q", *snapshot)
	}
}

func TestOutputCaptureCollectsStdoutAndStderrTails(t *testing.T) {
	capture := NewOutputCapture()

	capture.RecordStdout([]byte("stdout line\n"))
	capture.RecordStderr([]byte("stderr line\n"))

	tails := capture.CollectTailsAfterProcessExit()
	assertEqual(t, tails.StdoutCaptured, true)
	assertEqual(t, tails.StderrCaptured, true)
	assertEqual(t, *tails.StdoutTail, "stdout line\n")
	assertEqual(t, *tails.StderrTail, "stderr line\n")
}

func TestOutputCaptureTracksAbsentStreams(t *testing.T) {
	capture := NewOutputCapture()

	capture.RecordStdout([]byte("stdout line\n"))

	tails := capture.CollectTailsAfterProcessExit()
	assertEqual(t, tails.StdoutCaptured, true)
	assertEqual(t, tails.StderrCaptured, false)
	if tails.StderrTail != nil {
		t.Fatalf("expected stderr tail to be absent, got %q", *tails.StderrTail)
	}
}

func TestCaptureReaderOutputCapturesRealPipeReader(t *testing.T) {
	reader, writer := io.Pipe()
	capture := NewOutputCapture()
	capture.RegisterCaptureReader(reader, OutputStreamStdout)

	_, err := writer.Write([]byte(strings.Repeat("a", DefaultProcessStdoutTailBytes+3)))
	requireNoError(t, err)
	requireNoError(t, writer.Close())

	tails := capture.CollectTailsAfterProcessExit()
	if tails.StdoutTail == nil {
		t.Fatalf("expected stdout tail")
	}
	assertEqual(t, len(*tails.StdoutTail), DefaultProcessStdoutTailBytes)
	assertEqual(t, strings.HasPrefix(*tails.StdoutTail, "a"), true)
	assertEqual(t, strings.HasSuffix(*tails.StdoutTail, "a"), true)
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
