package sandboxdstate

import (
	"testing"
	"time"

	"github.com/mistle/sandboxd/runtime/readiness"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestSyncRuntimeReadinessFromSnapshotProjectsCurrentSupervisorState(t *testing.T) {
	supervisorHandle := newReadinessSupervisor(t)
	manager := &readiness.Manager{}

	SyncRuntimeReadinessFromSnapshot(supervisorHandle, manager, readiness.ModeCodex)
	assertEqual(t, manager.Ready(), false)

	supervisorHandle.ReplaceComponentDetails(supervision.ComponentCodexProxy, map[string]string{
		"sessionManagerState":  "Connected",
		"rawConnectivityState": "Connected",
	})
	supervisorHandle.MarkComponentStarting(supervision.ComponentCodexProxy)
	supervisorHandle.MarkComponentHealthy(supervision.ComponentCodexProxy)
	supervisorHandle.MarkComponentStarting(supervision.ComponentCodexAppServer)
	supervisorHandle.MarkComponentHealthy(supervision.ComponentCodexAppServer)
	supervisorHandle.MarkComponentStarting(supervision.ComponentRuntimeAgentEndpoint)
	supervisorHandle.MarkComponentHealthy(supervision.ComponentRuntimeAgentEndpoint)

	SyncRuntimeReadinessFromSnapshot(supervisorHandle, manager, readiness.ModeCodex)
	assertEqual(t, manager.Ready(), true)
}

func TestRuntimeReadinessProjectionLoopProjectsReadinessChanges(t *testing.T) {
	supervisorHandle := newReadinessSupervisor(t)
	manager := &readiness.Manager{}

	projectionHandle := SpawnRuntimeReadinessProjection(supervisorHandle, manager, readiness.ModeCodex, timeutil.ThreadSleeper{})
	defer projectionHandle.Close()

	requireReadiness(t, manager, false)

	supervisorHandle.ReplaceComponentDetails(supervision.ComponentCodexProxy, map[string]string{
		"sessionManagerState":  "Connected",
		"rawConnectivityState": "Connected",
	})
	supervisorHandle.MarkComponentStarting(supervision.ComponentCodexProxy)
	supervisorHandle.MarkComponentHealthy(supervision.ComponentCodexProxy)
	supervisorHandle.MarkComponentStarting(supervision.ComponentCodexAppServer)
	supervisorHandle.MarkComponentHealthy(supervision.ComponentCodexAppServer)
	supervisorHandle.MarkComponentStarting(supervision.ComponentRuntimeAgentEndpoint)
	supervisorHandle.MarkComponentHealthy(supervision.ComponentRuntimeAgentEndpoint)

	requireReadiness(t, manager, true)
}

func newReadinessSupervisor(t *testing.T) *supervision.SandboxdSupervisorHandle {
	t.Helper()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-readiness",
		timeutil.NewMutableClock(1_000),
		[]supervision.SupervisedComponent{
			supervision.ComponentCodexProxy,
			supervision.ComponentCodexAppServer,
			supervision.ComponentRuntimeAgentEndpoint,
		},
	)
	requireNoError(t, err)
	return supervisorHandle
}

func requireReadiness(t *testing.T, manager *readiness.Manager, expected bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if manager.Ready() == expected {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("expected runtime readiness %v, got %v", expected, manager.Ready())
}
