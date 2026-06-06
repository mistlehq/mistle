package readiness

import (
	"testing"
	"time"

	"github.com/mistle/sandboxd/supervision"
)

func TestPublishesImmediatelyWhenTunnelConnects(t *testing.T) {
	manager := &Manager{}
	manager.OnTunnelConnected()

	state := manager.TakeInitialPublishableState()
	if state == nil {
		t.Fatalf("expected tunnel connect to publish initial runtime readiness")
	}
	assertEqual(t, state.MessageType, ReadyMessageState)
	assertEqual(t, state.Ready, false)
}

func TestPublishesInitialStateForEachConnectedTunnel(t *testing.T) {
	manager := &Manager{}
	manager.SetReady(true)
	manager.OnTunnelConnected()
	first := manager.TakeInitialPublishableState()
	if first == nil {
		t.Fatalf("expected first initial readiness")
	}
	assertEqual(t, first.Ready, true)

	second := manager.TakeInitialPublishableState()
	if second == nil {
		t.Fatalf("expected repeated initial readiness for another tunnel")
	}
	assertEqual(t, second.Ready, true)
}

func TestPublishesWhenReadinessChanges(t *testing.T) {
	manager := &Manager{}
	manager.OnTunnelConnected()
	_ = manager.TakePublishableState()

	manager.SetReady(true)

	state := manager.TakePublishableState()
	if state == nil {
		t.Fatalf("expected readiness change to publish")
	}
	assertEqual(t, state.Ready, true)
}

func TestDoesNotPublishWhileDisconnected(t *testing.T) {
	manager := &Manager{}
	manager.SetReady(true)

	if state := manager.TakePublishableState(); state != nil {
		t.Fatalf("expected disconnected manager not to publish, got %#v", state)
	}
}

func TestDerivesRuntimeReadinessModes(t *testing.T) {
	tests := []struct {
		name     string
		mode     Mode
		snapshot supervision.HealthSnapshot
		ready    bool
	}{
		{name: "no agent", mode: ModeNoAgentRuntime, snapshot: snapshot(), ready: true},
		{name: "codex ready", mode: ModeCodex, snapshot: snapshot(
			codexProxy(supervision.ComponentHealthy, "Connected"),
			component(supervision.ComponentCodexAppServer, supervision.ComponentHealthy),
			component(supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentHealthy),
		), ready: true},
		{name: "codex proxy disconnected", mode: ModeCodex, snapshot: snapshot(
			codexProxy(supervision.ComponentHealthy, "Disconnected"),
			component(supervision.ComponentCodexAppServer, supervision.ComponentHealthy),
			component(supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentHealthy),
		), ready: false},
		{name: "codex proxy only", mode: ModeCodexProxyOnly, snapshot: snapshot(
			codexProxy(supervision.ComponentHealthy, "Connected"),
			component(supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentHealthy),
		), ready: true},
		{name: "opencode ready", mode: ModeOpenCode, snapshot: snapshot(
			component(supervision.ComponentOpenCodeProxy, supervision.ComponentHealthy),
			component(supervision.ComponentOpenCodeServer, supervision.ComponentHealthy),
			component(supervision.ComponentOpenCodeProxyConnectivity, supervision.ComponentHealthy),
			component(supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentHealthy),
		), ready: true},
		{name: "opencode server restarting", mode: ModeOpenCode, snapshot: snapshot(
			component(supervision.ComponentOpenCodeProxy, supervision.ComponentHealthy),
			component(supervision.ComponentOpenCodeServer, supervision.ComponentRestarting),
			component(supervision.ComponentOpenCodeProxyConnectivity, supervision.ComponentHealthy),
			component(supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentHealthy),
		), ready: false},
		{name: "opencode proxy-only without connectivity probe", mode: ModeOpenCodeProxyOnly, snapshot: snapshot(
			component(supervision.ComponentOpenCodeProxy, supervision.ComponentHealthy),
		), ready: true},
		{name: "pi ready", mode: ModePi, snapshot: snapshot(
			component(supervision.ComponentPiProxy, supervision.ComponentHealthy),
			component(supervision.ComponentPiRpcProcess, supervision.ComponentHealthy),
			component(supervision.ComponentPiProxyConnectivity, supervision.ComponentHealthy),
			component(supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentHealthy),
		), ready: true},
		{name: "pi rpc restarting", mode: ModePi, snapshot: snapshot(
			component(supervision.ComponentPiProxy, supervision.ComponentHealthy),
			component(supervision.ComponentPiRpcProcess, supervision.ComponentRestarting),
			component(supervision.ComponentPiProxyConnectivity, supervision.ComponentHealthy),
			component(supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentHealthy),
		), ready: false},
		{name: "pi proxy-only without connectivity probe", mode: ModePiProxyOnly, snapshot: snapshot(
			component(supervision.ComponentPiProxy, supervision.ComponentHealthy),
		), ready: true},
		{name: "agent endpoint restarting", mode: ModeCodexProxyOnly, snapshot: snapshot(
			codexProxy(supervision.ComponentHealthy, "Connected"),
			component(supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentRestarting),
		), ready: false},
		{name: "opencode connectivity restarting", mode: ModeOpenCode, snapshot: snapshot(
			component(supervision.ComponentOpenCodeProxy, supervision.ComponentHealthy),
			component(supervision.ComponentOpenCodeServer, supervision.ComponentHealthy),
			component(supervision.ComponentOpenCodeProxyConnectivity, supervision.ComponentRestarting),
			component(supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentHealthy),
		), ready: false},
		{name: "pi connectivity restarting", mode: ModePi, snapshot: snapshot(
			component(supervision.ComponentPiProxy, supervision.ComponentHealthy),
			component(supervision.ComponentPiRpcProcess, supervision.ComponentHealthy),
			component(supervision.ComponentPiProxyConnectivity, supervision.ComponentRestarting),
			component(supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentHealthy),
		), ready: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertEqual(t, DeriveRuntimeReady(test.snapshot, test.mode), test.ready)
		})
	}
}

func snapshot(components ...supervision.ComponentHealthSnapshot) supervision.HealthSnapshot {
	return supervision.HealthSnapshot{ObservedAt: time.Unix(0, 0), Components: components}
}

func component(component supervision.SupervisedComponent, state supervision.ComponentHealthState) supervision.ComponentHealthSnapshot {
	return supervision.ComponentHealthSnapshot{Component: component, State: state, Details: map[string]string{}}
}

func codexProxy(state supervision.ComponentHealthState, connectivityState string) supervision.ComponentHealthSnapshot {
	snapshot := component(supervision.ComponentCodexProxy, state)
	snapshot.Details["sessionManagerState"] = connectivityState
	snapshot.Details["rawConnectivityState"] = connectivityState
	return snapshot
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
