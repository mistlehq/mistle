//go:build linux

package tunnel

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/runtime/readiness"
	"github.com/mistle/sandboxd/timeutil"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

func TestLiveTunnelSessionOpensProcessesStreamWithSnapshot(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.NewMutableClock(104),
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(9),
		"channel":  map[string]any{"kind": "processes"},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	assertEqual(t, openOK["streamId"].(float64), float64(9))

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	messageType, payload, err := gatewayConnection.Read(ctx)
	requireNoError(t, err)
	assertEqual(t, messageType, websocket.MessageBinary)
	frame, snapshot, err := DecodeLiveTunnelDataFrame(payload)
	requireNoError(t, err)
	assertEqual(t, frame.StreamID, uint32(9))
	assertEqual(t, frame.PayloadKind, tunnelprotocol.PayloadKindWebSocketText)
	assertEqual(t, snapshot["type"].(string), "processes.snapshot")
	assertEqual(t, snapshot["observedAt"].(string), "1970-01-01T00:00:00.104Z")
}

func TestLiveTunnelSessionAuthorizesReachableHTTPPort(t *testing.T) {
	upstream := startPortAccessHTTPServer(t)
	_, portText, err := net.SplitHostPort(upstream.Listener.Addr().String())
	requireNoError(t, err)
	port, err := parseTestPort(portText)
	requireNoError(t, err)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "ports.target.authorize",
		"requestId": "ports_req_1",
		"target": map[string]any{
			"kind": "port",
			"port": float64(port),
		},
	})

	result := readControlOfType(t, gatewayConnection, "ports.target.authorize.result")
	assertEqual(t, result["requestId"].(string), "ports_req_1")
	assertEqual(t, result["authorized"].(bool), true)
	assertEqual(t, result["upstreamProtocol"].(string), "http")
	assertEqual(t, result["websocketCapable"].(bool), false)
}

func startPortAccessHTTPServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		responseWriter.WriteHeader(http.StatusOK)
		_, err := responseWriter.Write([]byte("ok"))
		requireNoError(t, err)
	}))
	t.Cleanup(server.Close)
	return server
}

func parseTestPort(portText string) (uint16, error) {
	port, err := strconv.ParseUint(portText, 10, 16)
	if err != nil {
		return 0, err
	}
	return uint16(port), nil
}
