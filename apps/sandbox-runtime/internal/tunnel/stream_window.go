package tunnel

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

const streamResetCodeStreamWindowExhausted = "stream_window_exhausted"

type streamSendWindow struct {
	mu             sync.Mutex
	availableBytes int
}

func newStreamSendWindow() *streamSendWindow {
	return &streamSendWindow{
		availableBytes: sessionprotocol.DefaultStreamWindowBytes,
	}
}

func (window *streamSendWindow) add(bytes int) error {
	if bytes <= 0 {
		return fmt.Errorf("stream.window bytes must be a positive integer")
	}

	window.mu.Lock()
	defer window.mu.Unlock()

	if window.availableBytes > sessionprotocol.MaxStreamWindowBytes-bytes {
		return fmt.Errorf(
			"stream.window credit exceeds configured maximum of %d bytes",
			sessionprotocol.MaxStreamWindowBytes,
		)
	}

	window.availableBytes += bytes
	return nil
}

func (window *streamSendWindow) tryConsume(bytes int) bool {
	if bytes < 0 {
		return false
	}

	window.mu.Lock()
	defer window.mu.Unlock()

	if bytes > window.availableBytes {
		return false
	}

	window.availableBytes -= bytes
	return true
}

func parseStreamWindow(payload []byte) (sessionprotocol.StreamWindow, error) {
	var windowMessage sessionprotocol.StreamWindow
	if err := json.Unmarshal(payload, &windowMessage); err != nil {
		return sessionprotocol.StreamWindow{}, fmt.Errorf("stream.window must be valid JSON: %w", err)
	}

	if windowMessage.Type != sessionprotocol.MessageTypeStreamWindow {
		return sessionprotocol.StreamWindow{}, fmt.Errorf(
			"stream.window request type must be '%s'",
			sessionprotocol.MessageTypeStreamWindow,
		)
	}
	if windowMessage.StreamID <= 0 {
		return sessionprotocol.StreamWindow{}, fmt.Errorf(
			"stream.window request streamId must be a positive integer",
		)
	}
	if windowMessage.Bytes <= 0 {
		return sessionprotocol.StreamWindow{}, fmt.Errorf(
			"stream.window request bytes must be a positive integer",
		)
	}

	return windowMessage, nil
}
