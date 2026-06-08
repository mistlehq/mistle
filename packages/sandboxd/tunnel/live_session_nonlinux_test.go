//go:build !linux

package tunnel

import (
	"context"
	"testing"

	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/runtime/readiness"
	"github.com/mistle/sandboxd/timeutil"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

func TestLiveTunnelSessionReturnsProcessesUnavailableOutsideLinux(t *testing.T) {
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
		"type":     "stream.open",
		"streamId": float64(9),
		"channel":  map[string]any{"kind": "processes"},
	})

	openError := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openError["type"].(string), "stream.open.error")
	assertEqual(t, openError["streamId"].(float64), float64(9))
	assertEqual(t, openError["code"].(string), tunnelprotocol.ConnectErrorCodeProcessesStreamUnavailable)
}
