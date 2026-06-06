package supervision

import (
	"encoding/json"
	"testing"

	"github.com/mistle/sandboxd/timeutil"
)

func TestSupervisorTracksStateTransitionsForOneComponent(t *testing.T) {
	clock := timeutil.NewMutableClock(10)
	handle := newTestSupervisor(t, clock, []SupervisedComponent{ComponentEgressProxy})

	initialSnapshot := requireComponentSnapshot(t, handle, ComponentEgressProxy)
	assertEqual(t, initialSnapshot.State, ComponentStopped)

	clock.AdvanceMS(5)
	handle.MarkComponentStarting(ComponentEgressProxy)
	startingSnapshot := requireComponentSnapshot(t, handle, ComponentEgressProxy)
	assertEqual(t, startingSnapshot.State, ComponentStarting)
	if startingSnapshot.LastStartedAt != nil {
		t.Fatalf("expected starting component to have no last start time")
	}

	clock.AdvanceMS(7)
	handle.MarkComponentHealthy(ComponentEgressProxy)
	healthySnapshot := requireComponentSnapshot(t, handle, ComponentEgressProxy)
	assertEqual(t, healthySnapshot.State, ComponentHealthy)
	assertEqual(t, *healthySnapshot.LastStartedAt, clock.NowSystemTime())
	assertEqual(t, *healthySnapshot.LastHealthcheckAt, clock.NowSystemTime())
	assertEqual(t, healthySnapshot.RestartCount, uint64(0))
}

func TestSupervisorIgnoresUpdatesForUntrackedComponents(t *testing.T) {
	handle := newTestSupervisor(t, timeutil.NewMutableClock(1), []SupervisedComponent{ComponentTunnelSession})

	handle.MarkComponentHealthy(ComponentCodexProxy)

	if handle.ComponentSnapshot(ComponentCodexProxy) != nil {
		t.Fatalf("expected untracked component not to be added implicitly")
	}
}

func TestSupervisorRecordsRestartFailuresForTrackedComponents(t *testing.T) {
	clock := timeutil.NewMutableClock(100)
	handle := newTestSupervisor(t, clock, []SupervisedComponent{ComponentCodexProxy})

	handle.MarkComponentStarting(ComponentCodexProxy)
	handle.MarkComponentHealthy(ComponentCodexProxy)
	clock.AdvanceMS(50)
	handle.MarkComponentRestarting(ComponentCodexProxy, "listener socket stopped accepting connections")

	snapshot := requireComponentSnapshot(t, handle, ComponentCodexProxy)
	assertEqual(t, snapshot.State, ComponentRestarting)
	assertEqual(t, snapshot.RestartCount, uint64(1))
	assertEqual(t, *snapshot.LastFailedAt, clock.NowSystemTime())
	assertEqual(t, *snapshot.LastError, "listener socket stopped accepting connections")
}

func TestSupervisorRestoresComponentSnapshotWithoutRewritingHealthMetadata(t *testing.T) {
	clock := timeutil.NewMutableClock(100)
	handle := newTestSupervisor(t, clock, []SupervisedComponent{ComponentTunnelSession})

	handle.ReplaceComponentDetails(ComponentTunnelSession, map[string]string{"gatewayWsUrl": "ws://accepted"})
	handle.MarkComponentStarting(ComponentTunnelSession)
	clock.AdvanceMS(10)
	handle.MarkComponentHealthy(ComponentTunnelSession)
	clock.AdvanceMS(10)
	handle.MarkComponentRestarting(ComponentTunnelSession, "accepted tunnel reconnecting")
	acceptedSnapshot := requireComponentSnapshot(t, handle, ComponentTunnelSession)

	clock.AdvanceMS(10)
	handle.ReplaceComponentDetails(ComponentTunnelSession, map[string]string{"gatewayWsUrl": "ws://candidate"})
	handle.MarkComponentHealthy(ComponentTunnelSession)
	handle.RestoreComponentSnapshot(acceptedSnapshot)

	restoredSnapshot := requireComponentSnapshot(t, handle, ComponentTunnelSession)
	assertEqual(t, restoredSnapshot.State, acceptedSnapshot.State)
	assertEqual(t, restoredSnapshot.RestartCount, acceptedSnapshot.RestartCount)
	assertEqual(t, *restoredSnapshot.LastFailedAt, *acceptedSnapshot.LastFailedAt)
	assertEqual(t, *restoredSnapshot.LastError, *acceptedSnapshot.LastError)
	assertEqual(t, restoredSnapshot.Details["gatewayWsUrl"], "ws://accepted")
}

func TestSupervisorStoresComponentDetails(t *testing.T) {
	handle := newTestSupervisor(t, timeutil.NewMutableClock(25), []SupervisedComponent{ComponentCodexProxy})

	handle.SetComponentDetail(ComponentCodexProxy, "listenAddr", "ws://127.0.0.1:4500")
	handle.SetComponentDetail(ComponentCodexProxy, "rawTarget", "ws://127.0.0.1:4501")
	handle.RemoveComponentDetail(ComponentCodexProxy, "rawTarget")

	snapshot := requireComponentSnapshot(t, handle, ComponentCodexProxy)
	assertEqual(t, snapshot.Details["listenAddr"], "ws://127.0.0.1:4500")
	if _, exists := snapshot.Details["rawTarget"]; exists {
		t.Fatalf("expected rawTarget detail to be removed")
	}
}

func TestSupervisorRecordsDaemonLivenessEdgesWithoutClearingActiveLag(t *testing.T) {
	clock := timeutil.NewMutableClock(1_000)
	handle := newTestSupervisor(t, clock, []SupervisedComponent{ComponentSandboxd})

	handle.RecordDaemonLivenessLagDetected(map[string]string{
		"lastLagMs": "40000",
		"maxLagMs":  "40000",
	}, 40_000, 30_000)
	handle.RecordDaemonLivenessSample(map[string]string{
		"lastLagMs": "45000",
		"maxLagMs":  "45000",
	})

	laggingSnapshot := requireComponentSnapshot(t, handle, ComponentSandboxd)
	assertEqual(t, laggingSnapshot.State, ComponentRestarting)
	assertEqual(t, *laggingSnapshot.LastError, "sandboxd liveness sampler was delayed by 40000ms, above 30000ms threshold")
	assertEqual(t, laggingSnapshot.Details["lastLagMs"], "45000")

	handle.RecordDaemonLivenessRecovered(map[string]string{
		"lastLagMs": "5",
		"maxLagMs":  "45000",
	}, 5, 30_000)

	recoveredSnapshot := requireComponentSnapshot(t, handle, ComponentSandboxd)
	assertEqual(t, recoveredSnapshot.State, ComponentHealthy)
	if recoveredSnapshot.LastError != nil {
		t.Fatalf("expected liveness recovery to clear error, got %s", *recoveredSnapshot.LastError)
	}

	lines := handle.DrainForwardedLifecycleEventLines()
	assertEqual(t, len(lines), 2)
	assertLifecycleEvent(t, lines[0], LifecycleEventDaemonLivenessLagDetected)
	assertLifecycleEvent(t, lines[1], LifecycleEventDaemonLivenessRecovered)
}

func TestSupervisorPreservesDaemonLivenessJournalErrorAcrossDetailReplacement(t *testing.T) {
	handle := newTestSupervisor(t, timeutil.NewMutableClock(1_000), []SupervisedComponent{ComponentSandboxd})
	handle.SetComponentDetail(ComponentSandboxd, DaemonLivenessJournalErrorDetail, "failed to write journal")

	handle.RecordDaemonLivenessSample(map[string]string{"lastLagMs": "10"})
	assertEqual(t, requireComponentSnapshot(t, handle, ComponentSandboxd).Details[DaemonLivenessJournalErrorDetail], "failed to write journal")

	handle.RecordDaemonLivenessLagDetected(map[string]string{"lastLagMs": "40000"}, 40_000, 30_000)
	assertEqual(t, requireComponentSnapshot(t, handle, ComponentSandboxd).Details[DaemonLivenessJournalErrorDetail], "failed to write journal")

	handle.RecordDaemonLivenessRecovered(map[string]string{"lastLagMs": "5"}, 5, 30_000)
	assertEqual(t, requireComponentSnapshot(t, handle, ComponentSandboxd).Details[DaemonLivenessJournalErrorDetail], "failed to write journal")

	handle.RemoveComponentDetail(ComponentSandboxd, DaemonLivenessJournalErrorDetail)
	if _, exists := requireComponentSnapshot(t, handle, ComponentSandboxd).Details[DaemonLivenessJournalErrorDetail]; exists {
		t.Fatalf("expected journal error detail to be removable")
	}
}

func TestSupervisorEmitsLifecycleLinesAndDrainsForwardingQueue(t *testing.T) {
	clock := timeutil.NewMutableClock(500)
	handle := newTestSupervisor(t, clock, []SupervisedComponent{ComponentEgressProxy})
	handle.ReplaceComponentDetails(ComponentEgressProxy, map[string]string{
		"listenAddr":  "127.0.0.1:38513",
		"stablePort":  "38513",
		"runtimeMode": "child_process",
		"childBinary": "/usr/local/bin/sandboxd",
		"childPid":    "1234",
	})

	handle.MarkComponentStarting(ComponentEgressProxy)
	clock.AdvanceMS(10)
	handle.MarkComponentHealthy(ComponentEgressProxy)
	clock.AdvanceMS(10)
	handle.MarkComponentRestarting(ComponentEgressProxy, "loopback connect failed")
	handle.EmitComponentHealthcheckFailed(ComponentEgressProxy, "loopback_connect_failed", "loopback connect failed", "loopback_tcp", nil)
	handle.EmitComponentRestartScheduled(ComponentEgressProxy, "retry_after_failure", 250, nil)
	clock.AdvanceMS(10)
	handle.MarkComponentStarting(ComponentEgressProxy)
	clock.AdvanceMS(10)
	handle.MarkComponentHealthy(ComponentEgressProxy)

	lines := handle.DrainForwardedLifecycleEventLines()
	assertEqual(t, len(lines), 6)
	events := make([]LifecycleEventName, 0, len(lines))
	for _, line := range lines {
		events = append(events, decodeLifecycleEvent(t, line))
	}
	assertEqual(t, events[0], LifecycleEventComponentStarting)
	assertEqual(t, events[1], LifecycleEventComponentStarted)
	assertEqual(t, events[2], LifecycleEventComponentHealthcheckFailed)
	assertEqual(t, events[3], LifecycleEventComponentRestartScheduled)
	assertEqual(t, events[4], LifecycleEventComponentStarting)
	assertEqual(t, events[5], LifecycleEventComponentRestartSucceeded)

	firstEvent := decodeLifecyclePayload(t, lines[0])
	assertEqual(t, firstEvent["runtimeMode"].(string), "child_process")
	assertEqual(t, firstEvent["childBinary"].(string), "/usr/local/bin/sandboxd")
	assertEqual(t, firstEvent["childPid"].(string), "1234")
}

func TestSupervisorDropsOldestForwardedLifecycleLinesWhenQueueIsFull(t *testing.T) {
	handle := newTestSupervisor(t, timeutil.NewMutableClock(1_000), []SupervisedComponent{ComponentCodexProxy})
	handle.SetComponentDetail(ComponentCodexProxy, "listenAddr", "ws://127.0.0.1:4500")
	errorText := "session manager ended"

	for eventIndex := 0; eventIndex < MaxForwardedLifecycleEventLines+3; eventIndex++ {
		handle.EmitComponentExited(ComponentCodexProxy, "runtime_thread_returned", &errorText, map[string]any{
			"sequence": uint64(eventIndex),
			"exitKind": "runtime_thread_returned",
		})
	}

	lines := handle.DrainForwardedLifecycleEventLines()
	assertEqual(t, len(lines), MaxForwardedLifecycleEventLines)
	firstLine := decodeLifecyclePayload(t, lines[0])
	assertEqual(t, firstLine["sequence"].(float64), float64(3))
}

func newTestSupervisor(t *testing.T, clock timeutil.Clock, components []SupervisedComponent) *SandboxdSupervisorHandle {
	t.Helper()
	handle, err := NewSandboxdSupervisorHandle("sandbox-123", clock, components)
	requireNoError(t, err)
	return handle
}

func requireComponentSnapshot(t *testing.T, handle *SandboxdSupervisorHandle, component SupervisedComponent) ComponentHealthSnapshot {
	t.Helper()
	snapshot := handle.ComponentSnapshot(component)
	if snapshot == nil {
		t.Fatalf("expected component %s to be tracked", component)
	}
	return *snapshot
}

func assertLifecycleEvent(t *testing.T, line string, expected LifecycleEventName) {
	t.Helper()
	assertEqual(t, decodeLifecycleEvent(t, line), expected)
}

func decodeLifecycleEvent(t *testing.T, line string) LifecycleEventName {
	t.Helper()
	payload := decodeLifecyclePayload(t, line)
	event, ok := payload["event"].(string)
	if !ok {
		t.Fatalf("expected lifecycle event payload to include string event, got %#v", payload)
	}
	return LifecycleEventName(event)
}

func decodeLifecyclePayload(t *testing.T, line string) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal([]byte(line), &payload); err != nil {
		t.Fatalf("expected lifecycle line to decode as json, got %v", err)
	}
	return payload
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
