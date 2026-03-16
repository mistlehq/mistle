package tunnel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

func TestReadConnectRequest(t *testing.T) {
	t.Run("reads valid connect request", func(t *testing.T) {
		payload, err := json.Marshal(sessionprotocol.StreamOpen{
			Type:     sessionprotocol.MessageTypeStreamOpen,
			StreamID: 11,
			Channel: sessionprotocol.StreamOpenChannel{
				Kind: sessionprotocol.ChannelKindAgent,
			},
		})
		if err != nil {
			t.Fatalf("expected request payload marshal to succeed: %v", err)
		}

		request, err := readConnectRequestFromServerPayload(t, websocket.MessageText, payload)
		if err != nil {
			t.Fatalf("expected readConnectRequest to succeed, got %v", err)
		}

		if request.Type != sessionprotocol.MessageTypeStreamOpen {
			t.Fatalf("expected type '%s', got '%s'", sessionprotocol.MessageTypeStreamOpen, request.Type)
		}
		if request.StreamID != 11 {
			t.Fatalf("expected streamId 11, got %d", request.StreamID)
		}
		if request.ChannelKind != sessionprotocol.ChannelKindAgent {
			t.Fatalf("expected channel kind '%s', got '%s'", sessionprotocol.ChannelKindAgent, request.ChannelKind)
		}
	})

	t.Run("rejects non-text websocket message", func(t *testing.T) {
		_, err := readConnectRequestFromServerPayload(t, websocket.MessageBinary, []byte("{}"))
		if err == nil {
			t.Fatal("expected readConnectRequest to fail for binary message")
		}
		if !strings.Contains(err.Error(), "expected connect request websocket text message") {
			t.Fatalf("expected non-text validation error, got %v", err)
		}
	})

	t.Run("rejects missing stream id", func(t *testing.T) {
		payload, err := json.Marshal(map[string]any{
			"type": sessionprotocol.MessageTypeStreamOpen,
			"channel": map[string]any{
				"kind": sessionprotocol.ChannelKindAgent,
			},
		})
		if err != nil {
			t.Fatalf("expected request payload marshal to succeed: %v", err)
		}

		_, readErr := readConnectRequestFromServerPayload(t, websocket.MessageText, payload)
		if readErr == nil {
			t.Fatal("expected readConnectRequest to fail when streamId is missing")
		}
		if !strings.Contains(readErr.Error(), "streamId must be a positive integer") {
			t.Fatalf("expected streamId validation error, got %v", readErr)
		}
	})
}

func TestParsePTYConnectRequest(t *testing.T) {
	t.Run("parses valid create request", func(t *testing.T) {
		payload, err := json.Marshal(sessionprotocol.StreamOpen{
			Type:     sessionprotocol.MessageTypeStreamOpen,
			StreamID: 12,
			Channel: sessionprotocol.StreamOpenChannel{
				Kind:    sessionprotocol.ChannelKindPTY,
				Session: sessionprotocol.PTYSessionModeCreate,
				Cols:    120,
				Rows:    40,
				Cwd:     "/home/sandbox",
			},
		})
		if err != nil {
			t.Fatalf("expected pty payload marshal to succeed: %v", err)
		}

		request, parseErr := parsePTYConnectRequest(payload)
		if parseErr != nil {
			t.Fatalf("expected parsePTYConnectRequest to succeed, got %v", parseErr)
		}
		if request.Channel.Session != sessionprotocol.PTYSessionModeCreate {
			t.Fatalf("expected pty session mode '%s', got '%s'", sessionprotocol.PTYSessionModeCreate, request.Channel.Session)
		}
	})

	t.Run("rejects invalid session mode", func(t *testing.T) {
		payload, err := json.Marshal(map[string]any{
			"type":     sessionprotocol.MessageTypeStreamOpen,
			"streamId": 22,
			"channel": map[string]any{
				"kind":    sessionprotocol.ChannelKindPTY,
				"session": "resume",
			},
		})
		if err != nil {
			t.Fatalf("expected pty payload marshal to succeed: %v", err)
		}

		_, parseErr := parsePTYConnectRequest(payload)
		if parseErr == nil {
			t.Fatal("expected parsePTYConnectRequest to fail for invalid session mode")
		}
		if !strings.Contains(parseErr.Error(), ptyConnectErrorCodeInvalidSessionSelection) {
			t.Fatalf("expected invalid session mode error, got %v", parseErr)
		}
	})

	t.Run("rejects cols and rows mismatch", func(t *testing.T) {
		payload, err := json.Marshal(map[string]any{
			"type":     sessionprotocol.MessageTypeStreamOpen,
			"streamId": 33,
			"channel": map[string]any{
				"kind":    sessionprotocol.ChannelKindPTY,
				"session": sessionprotocol.PTYSessionModeCreate,
				"cols":    120,
				"rows":    0,
			},
		})
		if err != nil {
			t.Fatalf("expected pty payload marshal to succeed: %v", err)
		}

		_, parseErr := parsePTYConnectRequest(payload)
		if parseErr == nil {
			t.Fatal("expected parsePTYConnectRequest to fail for invalid cols/rows")
		}
		if !strings.Contains(parseErr.Error(), "cols and rows must both be provided") {
			t.Fatalf("expected cols/rows validation error, got %v", parseErr)
		}
	})
}

func TestParseControlMessageType(t *testing.T) {
	t.Run("parses message type", func(t *testing.T) {
		messageType, err := parseControlMessageType([]byte(`{"type":"pty.resize"}`))
		if err != nil {
			t.Fatalf("expected parseControlMessageType to succeed, got %v", err)
		}
		if messageType != sessionprotocol.MessageTypePTYResize {
			t.Fatalf("expected message type '%s', got '%s'", sessionprotocol.MessageTypePTYResize, messageType)
		}
	})

	t.Run("rejects missing type", func(t *testing.T) {
		_, err := parseControlMessageType([]byte(`{"type":"  "}`))
		if err == nil {
			t.Fatal("expected parseControlMessageType to fail when type is missing")
		}
		if !strings.Contains(err.Error(), "control message type is required") {
			t.Fatalf("expected missing type validation error, got %v", err)
		}
	})
}

func readConnectRequestFromServerPayload(
	t *testing.T,
	messageType websocket.MessageType,
	payload []byte,
) (connectRequest, error) {
	t.Helper()

	handlerDone := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		conn, err := websocket.Accept(writer, request, nil)
		if err != nil {
			handlerDone <- err
			return
		}
		defer conn.CloseNow()

		handlerCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		handlerDone <- conn.Write(handlerCtx, messageType, payload)
		_ = conn.Close(websocket.StatusNormalClosure, "done")
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatalf("expected websocket dial to succeed: %v", err)
	}
	defer conn.CloseNow()

	readResult, readErr := readConnectRequest(ctx, conn)

	if handlerErr := <-handlerDone; handlerErr != nil {
		t.Fatalf("expected websocket handler to succeed: %v", handlerErr)
	}

	return readResult, readErr
}
