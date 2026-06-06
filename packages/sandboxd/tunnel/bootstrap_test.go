package tunnel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestConnectBootstrapTunnelAppendsBootstrapTokenAndSendsText(t *testing.T) {
	requests := make(chan bootstrapTunnelRequest, 1)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.Close(websocket.StatusNormalClosure, "")
		_, payload, err := connection.Read(request.Context())
		if err != nil {
			return
		}
		requests <- bootstrapTunnelRequest{
			rawQuery: request.URL.RawQuery,
			payload:  string(payload),
		}
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sandbox/sbi_bootstrap?existing=1"

	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, " bootstrap-token ")
	requireNoError(t, err)
	defer tunnel.Close()
	requireNoError(t, tunnel.SendText(context.Background(), "hello"))

	request := receiveBootstrapTunnelRequest(t, requests)
	assertEqual(t, request.rawQuery, "existing=1&bootstrap_token=bootstrap-token")
	assertEqual(t, request.payload, "hello")
	if !strings.Contains(tunnel.ConnectedURL(), "bootstrap_token=bootstrap-token") {
		t.Fatalf("expected connected URL to include bootstrap token, got %q", tunnel.ConnectedURL())
	}
}

func TestConnectBootstrapTunnelRejectsInvalidInputs(t *testing.T) {
	_, missingTokenErr := ConnectBootstrapTunnel(context.Background(), "ws://gateway.example.test/tunnel/sbi", " ")
	_, invalidSchemeErr := ConnectBootstrapTunnel(context.Background(), "http://gateway.example.test/tunnel/sbi", "token")

	if missingTokenErr == nil {
		t.Fatalf("expected missing token to fail")
	}
	assertEqual(t, missingTokenErr.Error(), "sandbox tunnel bootstrap token is required")
	if invalidSchemeErr == nil {
		t.Fatalf("expected invalid scheme to fail")
	}
	assertEqual(t, invalidSchemeErr.Error(), "sandbox tunnel gateway ws url must use ws or wss scheme")
}

func TestBootstrapTunnelSendAfterCloseFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.Close(websocket.StatusNormalClosure, "")
		_, _, _ = connection.Read(request.Context())
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sandbox/sbi_bootstrap"
	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token")
	requireNoError(t, err)
	requireNoError(t, tunnel.Close())

	err = tunnel.SendText(context.Background(), "hello")

	if err == nil {
		t.Fatalf("expected send after close to fail")
	}
	assertEqual(t, err.Error(), "bootstrap tunnel is already closed")
}

type bootstrapTunnelRequest struct {
	rawQuery string
	payload  string
}

func receiveBootstrapTunnelRequest(t *testing.T, requests <-chan bootstrapTunnelRequest) bootstrapTunnelRequest {
	t.Helper()
	select {
	case request := <-requests:
		return request
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for bootstrap websocket request")
		return bootstrapTunnelRequest{}
	}
}
