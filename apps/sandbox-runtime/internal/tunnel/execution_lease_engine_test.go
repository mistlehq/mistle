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

func TestExecutionLeaseEngine(t *testing.T) {
	t.Run("writes lease.create and lease.renew over the bootstrap tunnel", func(t *testing.T) {
		engine := newExecutionLeaseEngine()
		clientConn, serverConn := createWebSocketPair(t)
		defer clientConn.CloseNow()
		defer serverConn.CloseNow()

		engine.AttachTunnelConnection(clientConn)

		lease := sessionprotocol.ExecutionLease{
			ID:                  "sxl_test",
			Kind:                "agent_execution",
			Source:              "codex",
			ExternalExecutionID: "turn_123",
			Metadata: map[string]any{
				"threadId": "thr_123",
			},
		}

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		if err := engine.Create(ctx, lease); err != nil {
			t.Fatalf("expected execution lease create to succeed: %v", err)
		}

		leaseCreatePayload := readTextMessage(t, ctx, serverConn)
		var leaseCreate sessionprotocol.LeaseCreate
		if err := json.Unmarshal(leaseCreatePayload, &leaseCreate); err != nil {
			t.Fatalf("expected lease.create payload to unmarshal: %v", err)
		}
		if leaseCreate.Type != sessionprotocol.MessageTypeLeaseCreate {
			t.Fatalf("expected lease.create type, got %q", leaseCreate.Type)
		}
		if leaseCreate.Lease.ID != lease.ID {
			t.Fatalf("expected lease.create id %q, got %q", lease.ID, leaseCreate.Lease.ID)
		}

		if err := engine.Renew(ctx, lease.ID); err != nil {
			t.Fatalf("expected execution lease renew to succeed: %v", err)
		}

		leaseRenewPayload := readTextMessage(t, ctx, serverConn)
		var leaseRenew sessionprotocol.LeaseRenew
		if err := json.Unmarshal(leaseRenewPayload, &leaseRenew); err != nil {
			t.Fatalf("expected lease.renew payload to unmarshal: %v", err)
		}
		if leaseRenew.Type != sessionprotocol.MessageTypeLeaseRenew {
			t.Fatalf("expected lease.renew type, got %q", leaseRenew.Type)
		}
		if leaseRenew.LeaseID != lease.ID {
			t.Fatalf("expected lease.renew id %q, got %q", lease.ID, leaseRenew.LeaseID)
		}
	})

	t.Run("rejects duplicate execution lease ids", func(t *testing.T) {
		engine := newExecutionLeaseEngine()
		clientConn, serverConn := createWebSocketPair(t)
		defer clientConn.CloseNow()
		defer serverConn.CloseNow()

		engine.AttachTunnelConnection(clientConn)

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		lease := sessionprotocol.ExecutionLease{
			ID:     "sxl_duplicate",
			Kind:   "agent_execution",
			Source: "codex",
		}

		if err := engine.Create(ctx, lease); err != nil {
			t.Fatalf("expected first execution lease create to succeed: %v", err)
		}
		_ = readTextMessage(t, ctx, serverConn)

		err := engine.Create(ctx, lease)
		if err == nil {
			t.Fatal("expected duplicate execution lease create to fail")
		}
		if !strings.Contains(err.Error(), "already tracked") {
			t.Fatalf("expected duplicate execution lease error, got %v", err)
		}

		noMessageCtx, cancelNoMessage := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancelNoMessage()

		_, _, readErr := serverConn.Read(noMessageCtx)
		if readErr == nil {
			t.Fatal("expected duplicate execution lease create not to write a second message")
		}
	})

	t.Run("fails when no bootstrap tunnel connection is attached", func(t *testing.T) {
		engine := newExecutionLeaseEngine()

		err := engine.Create(context.Background(), sessionprotocol.ExecutionLease{
			ID:     "sxl_missing_conn",
			Kind:   "agent_execution",
			Source: "codex",
		})
		if err == nil {
			t.Fatal("expected create to fail without an attached bootstrap tunnel")
		}
		if !strings.Contains(err.Error(), "not attached") {
			t.Fatalf("expected missing tunnel error, got %v", err)
		}
	})

	t.Run("fails to renew an unknown execution lease", func(t *testing.T) {
		engine := newExecutionLeaseEngine()
		clientConn, serverConn := createWebSocketPair(t)
		defer clientConn.CloseNow()
		defer serverConn.CloseNow()

		engine.AttachTunnelConnection(clientConn)

		err := engine.Renew(context.Background(), "sxl_unknown")
		if err == nil {
			t.Fatal("expected renew of unknown execution lease to fail")
		}
		if !strings.Contains(err.Error(), "not tracked") {
			t.Fatalf("expected unknown execution lease error, got %v", err)
		}
	})
}

func createWebSocketPair(t *testing.T) (*websocket.Conn, *websocket.Conn) {
	t.Helper()

	serverConnCh := make(chan *websocket.Conn, 1)
	serverErrCh := make(chan error, 1)

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		serverConn, err := websocket.Accept(writer, request, nil)
		if err != nil {
			serverErrCh <- err
			return
		}

		serverConnCh <- serverConn
	}))
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	clientConn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatalf("expected websocket dial to succeed: %v", err)
	}

	select {
	case serverErr := <-serverErrCh:
		t.Fatalf("expected websocket accept to succeed: %v", serverErr)
	case serverConn := <-serverConnCh:
		return clientConn, serverConn
	case <-ctx.Done():
		t.Fatal("timed out waiting for websocket server connection")
	}

	return nil, nil
}

func readTextMessage(t *testing.T, ctx context.Context, conn *websocket.Conn) []byte {
	t.Helper()

	messageType, payload, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("expected websocket read to succeed: %v", err)
	}
	if messageType != websocket.MessageText {
		t.Fatalf("expected websocket text message, got %s", messageType.String())
	}

	return payload
}
