package process

import (
	"io"
	"sync"
)

const (
	DefaultProcessStdoutTailBytes = 4 * 1024
	DefaultProcessStderrTailBytes = 8 * 1024
)

type OutputStream string

const (
	OutputStreamStdout OutputStream = "stdout"
	OutputStreamStderr OutputStream = "stderr"
)

type OutputTails struct {
	StdoutTail     *string
	StderrTail     *string
	StdoutCaptured bool
	StderrCaptured bool
}

type OutputCapture struct {
	stdout         *TailBuffer
	stderr         *TailBuffer
	stdoutMutex    sync.Mutex
	stderrMutex    sync.Mutex
	captureWaiters sync.WaitGroup
}

func NewOutputCapture() *OutputCapture {
	return &OutputCapture{
		stdout: NewTailBuffer(DefaultProcessStdoutTailBytes),
		stderr: NewTailBuffer(DefaultProcessStderrTailBytes),
	}
}

func (capture *OutputCapture) RecordStdout(bytes []byte) {
	capture.stdoutMutex.Lock()
	defer capture.stdoutMutex.Unlock()
	capture.stdout.Append(bytes)
}

func (capture *OutputCapture) RecordStderr(bytes []byte) {
	capture.stderrMutex.Lock()
	defer capture.stderrMutex.Unlock()
	capture.stderr.Append(bytes)
}

func (capture *OutputCapture) StdoutTail() *string {
	capture.stdoutMutex.Lock()
	defer capture.stdoutMutex.Unlock()
	return capture.stdout.Snapshot()
}

func (capture *OutputCapture) StderrTail() *string {
	capture.stderrMutex.Lock()
	defer capture.stderrMutex.Unlock()
	return capture.stderr.Snapshot()
}

func (capture *OutputCapture) RegisterCaptureReader(reader io.Reader, stream OutputStream) {
	capture.captureWaiters.Add(1)
	go func() {
		defer capture.captureWaiters.Done()
		CaptureReaderOutput(reader, capture, stream)
	}()
}

func (capture *OutputCapture) FinishCaptureReaders() {
	capture.captureWaiters.Wait()
}

func (capture *OutputCapture) CollectTailsAfterProcessExit() OutputTails {
	capture.FinishCaptureReaders()
	stdoutTail := capture.StdoutTail()
	stderrTail := capture.StderrTail()
	return OutputTails{
		StdoutCaptured: stdoutTail != nil,
		StderrCaptured: stderrTail != nil,
		StdoutTail:     stdoutTail,
		StderrTail:     stderrTail,
	}
}

type TailBuffer struct {
	maxBytes int
	bytes    []byte
}

func NewTailBuffer(maxBytes int) *TailBuffer {
	return &TailBuffer{maxBytes: maxBytes}
}

func (buffer *TailBuffer) Append(chunk []byte) {
	buffer.bytes = append(buffer.bytes, chunk...)
	if len(buffer.bytes) <= buffer.maxBytes {
		return
	}
	buffer.bytes = append([]byte(nil), buffer.bytes[len(buffer.bytes)-buffer.maxBytes:]...)
}

func (buffer *TailBuffer) Snapshot() *string {
	if len(buffer.bytes) == 0 {
		return nil
	}
	snapshot := string(buffer.bytes)
	return &snapshot
}

func CaptureReaderOutput(reader io.Reader, outputCapture *OutputCapture, stream OutputStream) {
	buffer := make([]byte, 4096)
	for {
		bytesRead, err := reader.Read(buffer)
		if bytesRead > 0 {
			switch stream {
			case OutputStreamStdout:
				outputCapture.RecordStdout(buffer[:bytesRead])
			case OutputStreamStderr:
				outputCapture.RecordStderr(buffer[:bytesRead])
			}
		}
		if err != nil {
			return
		}
	}
}
