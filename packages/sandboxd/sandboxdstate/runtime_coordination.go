package sandboxdstate

import (
	"sync"
	"time"

	"github.com/mistle/sandboxd/process"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

const (
	RuntimeCoordinationPollInterval = 250 * time.Millisecond
	CodexProxyRecoveryTimeout       = 5 * time.Second
)

type RuntimeCoordinationHandles struct {
	CodexAppServerControlHandle *process.CodexAppServerControlHandle
	CodexProxyControlHandle     *CodexProxyControlHandle
	OpenCodeServerControlHandle *process.OpenCodeServerControlHandle
}

type RuntimeCoordinationHandle struct {
	shutdown chan struct{}
	done     chan struct{}
	once     sync.Once
}

func (handles RuntimeCoordinationHandles) HasRuntimeProcessControl() bool {
	return handles.OpenCodeServerControlHandle != nil ||
		(handles.CodexAppServerControlHandle != nil && handles.CodexProxyControlHandle != nil)
}

func StartRuntimeCoordination(
	handles RuntimeCoordinationHandles,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
) *RuntimeCoordinationHandle {
	handle := &RuntimeCoordinationHandle{
		shutdown: make(chan struct{}),
		done:     make(chan struct{}),
	}
	go func() {
		defer close(handle.done)
		runRuntimeCoordinationLoop(handles, supervisorHandle, clock, sleeper, handle.shutdown)
	}()
	return handle
}

func (handle *RuntimeCoordinationHandle) Close() {
	if handle == nil {
		return
	}
	handle.once.Do(func() {
		close(handle.shutdown)
		<-handle.done
	})
}

func runRuntimeCoordinationLoop(
	handles RuntimeCoordinationHandles,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
	shutdown <-chan struct{},
) {
	for !coordinationShutdownRequested(shutdown) {
		coordinateCodexRuntime(handles.CodexAppServerControlHandle, handles.CodexProxyControlHandle, supervisorHandle, clock, sleeper, shutdown)
		coordinateOpenCodeRuntime(handles.OpenCodeServerControlHandle, supervisorHandle, clock, sleeper)
		sleeper.Sleep(RuntimeCoordinationPollInterval)
	}
}

func coordinateCodexRuntime(
	codexAppServerControlHandle *process.CodexAppServerControlHandle,
	codexProxyControlHandle *CodexProxyControlHandle,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
	shutdown <-chan struct{},
) {
	if codexAppServerControlHandle == nil || codexProxyControlHandle == nil {
		return
	}
	snapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentCodexAppServer)
	if snapshot == nil || snapshot.State != supervision.ComponentRestarting {
		return
	}

	supervisorHandle.EmitComponentRestartScheduled(
		supervision.ComponentCodexAppServer,
		componentRestartReason(snapshot),
		0,
		nil,
	)
	if err := codexAppServerControlHandle.Restart(clock, sleeper); err != nil {
		return
	}
	if waitForCodexProxyRecovery(codexProxyControlHandle, CodexProxyRecoveryTimeout, shutdown) {
		return
	}
	if err := codexProxyControlHandle.RequestRestart(); err != nil {
		return
	}
	_ = waitForCodexProxyRecovery(codexProxyControlHandle, CodexProxyRecoveryTimeout, shutdown)
}

func coordinateOpenCodeRuntime(
	openCodeServerControlHandle *process.OpenCodeServerControlHandle,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
) {
	if openCodeServerControlHandle == nil {
		return
	}
	snapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentOpenCodeServer)
	if snapshot == nil || snapshot.State != supervision.ComponentRestarting {
		return
	}

	supervisorHandle.EmitComponentRestartScheduled(
		supervision.ComponentOpenCodeServer,
		componentRestartReason(snapshot),
		0,
		nil,
	)
	_ = openCodeServerControlHandle.Restart(clock, sleeper)
}

func componentRestartReason(snapshot *supervision.ComponentHealthSnapshot) string {
	if snapshot.Details["livenessState"] == "Exited" {
		return "coordinated_restart_after_exit"
	}
	return "coordinated_restart_after_readiness_failure"
}

func waitForCodexProxyRecovery(
	codexProxyControlHandle *CodexProxyControlHandle,
	timeout time.Duration,
	shutdown <-chan struct{},
) bool {
	deadline := time.Now().Add(timeout)
	for {
		if coordinationShutdownRequested(shutdown) {
			return false
		}
		snapshot := codexProxyControlHandle.Snapshot()
		if snapshot != nil &&
			snapshot.State == supervision.ComponentHealthy &&
			snapshot.Details["rawConnectivityState"] == string(codexproxyHealthConnected) &&
			snapshot.Details["sessionManagerState"] == string(codexproxyHealthConnected) {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(RuntimeCoordinationPollInterval)
	}
}

func coordinationShutdownRequested(shutdown <-chan struct{}) bool {
	select {
	case <-shutdown:
		return true
	default:
		return false
	}
}

type codexproxyHealthState string

const codexproxyHealthConnected codexproxyHealthState = "Connected"
