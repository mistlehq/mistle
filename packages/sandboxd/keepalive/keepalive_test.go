package keepalive

import (
	"testing"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/timeutil"
)

func TestPublishesImmediatelyWhenTunnelConnects(t *testing.T) {
	clock := timeutil.NewMutableClock(1000)
	manager := &Manager{}

	manager.OnTunnelConnected(clock)

	state := manager.TakePublishableState(clock)
	if state == nil {
		t.Fatalf("expected tunnel connect to trigger immediate publish")
	}
	assertEqual(t, state.MessageType, protocol.KeepaliveMessageState)
	assertEqual(t, state.TTLMS, KeepaliveTTLMS)
	assertEqual(t, state.Active, false)
}

func TestPublishesAgainWhenActivityChanges(t *testing.T) {
	clock := timeutil.NewMutableClock(1000)
	manager := &Manager{}
	manager.OnTunnelConnected(clock)
	_ = manager.TakePublishableState(clock)

	manager.SetUserActive(true)

	state := manager.TakePublishableState(clock)
	if state == nil {
		t.Fatalf("expected activity change to trigger publish")
	}
	assertEqual(t, state.Active, true)
}

func TestTreatsExtraPlatformProcessesAsKeepaliveActivity(t *testing.T) {
	manager := &Manager{}

	manager.SetPlatformProcessActive(true)

	assertEqual(t, manager.Active(), true)
}

func TestPublishesHeartbeatAfterFixedInterval(t *testing.T) {
	clock := timeutil.NewMutableClock(1000)
	manager := &Manager{}
	manager.OnTunnelConnected(clock)
	_ = manager.TakePublishableState(clock)

	clock.AdvanceMS(uint64(KeepaliveHeartbeatInterval.Milliseconds()))

	state := manager.TakePublishableState(clock)
	if state == nil {
		t.Fatalf("expected heartbeat interval to trigger publish")
	}
	assertEqual(t, state.Active, false)
}

func TestDoesNotPublishWhileDisconnected(t *testing.T) {
	clock := timeutil.NewMutableClock(1000)
	manager := &Manager{}
	manager.OnTunnelConnected(clock)
	_ = manager.TakePublishableState(clock)
	manager.OnTunnelDisconnected()

	manager.SetPlatformActive(true)

	if state := manager.TakePublishableState(clock); state != nil {
		t.Fatalf("expected disconnected tunnel not to publish, got %#v", state)
	}
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
