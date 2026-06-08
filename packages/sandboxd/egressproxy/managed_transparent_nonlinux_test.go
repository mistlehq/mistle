//go:build !linux

package egressproxy

import (
	"net"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestManagedProxyFailsFastForTransparentPacketRulesWithoutLinuxSupport(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	listenAddr := listener.Addr().String()
	requireNoError(t, listener.Close())
	transparentListener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	transparentListenAddr := transparentListener.Addr().String()
	requireNoError(t, transparentListener.Close())
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sbi_transparent_nonlinux",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{supervision.ComponentEgressProxy},
	)
	requireNoError(t, err)

	proxy, err := StartManagedProxy(
		runtime.CompiledRuntimePlan{},
		protocol.SessionRuntimeInput{
			TunnelGatewayWSURL: "ws://gateway.example.test/tunnel",
			TransparentProxy: &protocol.TransparentProxyConfiguration{
				PassthroughBypass: protocol.TransparentProxyBypass{
					Kind: protocol.TransparentProxyBypassSocketMark,
					Mark: DefaultTransparentProxyPort,
				},
			},
		},
		StaticEgressTokenProvider{TokenValue: "gateway-token"},
		timeutil.NewMutableClock(1_700_000_000_000),
		supervisorHandle,
		ManagedProxyOptions{
			ListenAddr:               listenAddr,
			TransparentListenAddr:    transparentListenAddr,
			RuntimeProxyCABundlePath: filepath.Join(t.TempDir(), "egress-proxy-ca-bundle.pem"),
		},
	)

	if err == nil {
		_ = proxy.Close()
		t.Fatalf("expected transparent proxy startup to fail without Linux packet-rule support")
	}
	if !strings.Contains(err.Error(), "transparent proxy local destination route discovery requires Linux support") {
		t.Fatalf("expected Linux support error, got %v", err)
	}
	reboundListener, err := net.Listen("tcp", listenAddr)
	requireNoError(t, err)
	requireNoError(t, reboundListener.Close())
}
