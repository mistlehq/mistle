package tunnel

import (
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

func TestStreamSendWindow(t *testing.T) {
	t.Run("starts with the default stream window and consumes bytes", func(t *testing.T) {
		window := newStreamSendWindow()

		if !window.tryConsume(sessionprotocol.DefaultStreamWindowBytes - 1) {
			t.Fatal("expected initial stream window credit to be available")
		}
		if window.tryConsume(2) {
			t.Fatal("expected send window consumption to fail once credit is exhausted")
		}
	})

	t.Run("adds stream.window credit", func(t *testing.T) {
		window := newStreamSendWindow()
		if !window.tryConsume(sessionprotocol.DefaultStreamWindowBytes) {
			t.Fatal("expected initial stream window consumption to succeed")
		}

		if err := window.add(1024); err != nil {
			t.Fatalf("expected stream.window credit add to succeed: %v", err)
		}
		if !window.tryConsume(1024) {
			t.Fatal("expected added stream.window credit to be consumable")
		}
	})

	t.Run("rejects stream.window credit that exceeds the configured maximum", func(t *testing.T) {
		window := newStreamSendWindow()

		err := window.add(1)
		if err == nil {
			t.Fatal("expected stream.window credit add to fail when it exceeds the configured maximum")
		}
		if err.Error() != "stream.window credit exceeds configured maximum of 65536 bytes" {
			t.Fatalf("unexpected stream.window cap error: %v", err)
		}
	})
}

func TestParseStreamWindow(t *testing.T) {
	streamWindow, err := parseStreamWindow([]byte(`{"type":"stream.window","streamId":7,"bytes":1024}`))
	if err != nil {
		t.Fatalf("expected parseStreamWindow to succeed: %v", err)
	}

	if streamWindow.Type != sessionprotocol.MessageTypeStreamWindow {
		t.Fatalf("expected stream.window type, got %q", streamWindow.Type)
	}
	if streamWindow.StreamID != 7 {
		t.Fatalf("expected stream.window streamId 7, got %d", streamWindow.StreamID)
	}
	if streamWindow.Bytes != 1024 {
		t.Fatalf("expected stream.window bytes 1024, got %d", streamWindow.Bytes)
	}
}
