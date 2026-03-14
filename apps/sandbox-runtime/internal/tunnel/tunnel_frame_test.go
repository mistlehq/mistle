package tunnel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

func TestReadTunnelFrameDecodesBinaryDataFrame(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		conn, err := websocket.Accept(writer, request, nil)
		if err != nil {
			t.Fatalf("expected websocket accept to succeed: %v", err)
		}
		defer conn.CloseNow()

		encodedFrame, err := sessionprotocol.EncodeDataFrame(struct {
			StreamID    uint32
			PayloadKind byte
			Payload     []byte
		}{
			StreamID:    5,
			PayloadKind: sessionprotocol.PayloadKindRawBytes,
			Payload:     []byte("tty"),
		})
		if err != nil {
			t.Fatalf("expected data frame encode to succeed: %v", err)
		}

		writeCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := conn.Write(writeCtx, websocket.MessageBinary, encodedFrame); err != nil {
			t.Fatalf("expected websocket write to succeed: %v", err)
		}
	}))
	defer server.Close()

	conn, _, err := websocket.Dial(context.Background(), "ws"+server.URL[len("http"):], nil)
	if err != nil {
		t.Fatalf("expected websocket dial to succeed: %v", err)
	}
	defer conn.CloseNow()

	readCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	frame, err := readTunnelFrame(readCtx, conn)
	if err != nil {
		t.Fatalf("expected tunnel frame read to succeed: %v", err)
	}
	if frame.MessageType != websocket.MessageBinary {
		t.Fatalf("expected binary message type, got %s", frame.MessageType.String())
	}
	if frame.DataFrame == nil {
		t.Fatal("expected decoded data frame for binary payload")
	}
	if frame.DataFrame.StreamID != 5 {
		t.Fatalf("expected streamId 5, got %d", frame.DataFrame.StreamID)
	}
	if string(frame.DataFrame.Payload) != "tty" {
		t.Fatalf("expected payload %q, got %q", "tty", string(frame.DataFrame.Payload))
	}
}

func TestReadTunnelFrameRejectsMalformedBinaryDataFrame(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		conn, err := websocket.Accept(writer, request, nil)
		if err != nil {
			t.Fatalf("expected websocket accept to succeed: %v", err)
		}
		defer conn.CloseNow()

		writeCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := conn.Write(writeCtx, websocket.MessageBinary, []byte{0x01}); err != nil {
			t.Fatalf("expected websocket write to succeed: %v", err)
		}
	}))
	defer server.Close()

	conn, _, err := websocket.Dial(context.Background(), "ws"+server.URL[len("http"):], nil)
	if err != nil {
		t.Fatalf("expected websocket dial to succeed: %v", err)
	}
	defer conn.CloseNow()

	readCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	_, err = readTunnelFrame(readCtx, conn)
	if err == nil {
		t.Fatal("expected malformed binary data frame to fail")
	}
}
