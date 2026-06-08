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

func TestSyncRuntimeReadinessFromSnapshotProjectsOpenCodeAndPiRuntimeStates(t *testing.T) {
	tests := []struct {
		name       string
		mode       readiness.Mode
		components []supervision.SupervisedComponent
		ready      func(*supervision.SandboxdSupervisorHandle)
		notReady   func(*supervision.SandboxdSupervisorHandle)
	}{
		{
			name: "opencode",
			mode: readiness.ModeOpenCode,
			components: []supervision.SupervisedComponent{
				supervision.ComponentOpenCodeProxy,
				supervision.ComponentOpenCodeServer,
				supervision.ComponentOpenCodeProxyConnectivity,
				supervision.ComponentRuntimeAgentEndpoint,
			},
			ready: func(supervisorHandle *supervision.SandboxdSupervisorHandle) {
				markReadinessComponentHealthy(supervisorHandle, supervision.ComponentOpenCodeProxy)
				markReadinessComponentHealthy(supervisorHandle, supervision.ComponentOpenCodeServer)
				markReadinessComponentHealthy(supervisorHandle, supervision.ComponentOpenCodeProxyConnectivity)
				markReadinessComponentHealthy(supervisorHandle, supervision.ComponentRuntimeAgentEndpoint)
			},
			notReady: func(supervisorHandle *supervision.SandboxdSupervisorHandle) {
				supervisorHandle.MarkComponentRestarting(supervision.ComponentOpenCodeServer, "readiness failed")
			},
		},
		{
			name: "pi",
			mode: readiness.ModePi,
			components: []supervision.SupervisedComponent{
				supervision.ComponentPiProxy,
				supervision.ComponentPiRpcProcess,
				supervision.ComponentPiProxyConnectivity,
				supervision.ComponentRuntimeAgentEndpoint,
			},
			ready: func(supervisorHandle *supervision.SandboxdSupervisorHandle) {
				markReadinessComponentHealthy(supervisorHandle, supervision.ComponentPiProxy)
				markReadinessComponentHealthy(supervisorHandle, supervision.ComponentPiRpcProcess)
				markReadinessComponentHealthy(supervisorHandle, supervision.ComponentPiProxyConnectivity)
				markReadinessComponentHealthy(supervisorHandle, supervision.ComponentRuntimeAgentEndpoint)
			},
			notReady: func(supervisorHandle *supervision.SandboxdSupervisorHandle) {
				supervisorHandle.MarkComponentRestarting(supervision.ComponentPiRpcProcess, "readiness failed")
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			supervisorHandle := newReadinessSupervisorWithComponents(t, test.components)
			manager := &readiness.Manager{}

			test.ready(supervisorHandle)
			SyncRuntimeReadinessFromSnapshot(supervisorHandle, manager, test.mode)
			assertEqual(t, manager.Ready(), true)

			test.notReady(supervisorHandle)
			SyncRuntimeReadinessFromSnapshot(supervisorHandle, manager, test.mode)
			assertEqual(t, manager.Ready(), false)
		})
	}
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
	return newReadinessSupervisorWithComponents(t, []supervision.SupervisedComponent{
		supervision.ComponentCodexProxy,
		supervision.ComponentCodexAppServer,
		supervision.ComponentRuntimeAgentEndpoint,
	})
}

func newReadinessSupervisorWithComponents(
	t *testing.T,
	components []supervision.SupervisedComponent,
) *supervision.SandboxdSupervisorHandle {
	t.Helper()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-readiness",
		timeutil.NewMutableClock(1_000),
		components,
	)
	requireNoError(t, err)
	return supervisorHandle
}

func markReadinessComponentHealthy(
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	component supervision.SupervisedComponent,
) {
	supervisorHandle.MarkComponentStarting(component)
	supervisorHandle.MarkComponentHealthy(component)
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
