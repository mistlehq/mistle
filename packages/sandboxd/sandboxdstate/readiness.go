package sandboxdstate

import (
	"sync"
	"time"

	"github.com/mistle/sandboxd/runtime/readiness"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

const RuntimeReadinessProjectionPollInterval = 100 * time.Millisecond

func SyncRuntimeReadinessFromSnapshot(
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	runtimeReadinessManager *readiness.Manager,
	runtimeReadinessMode readiness.Mode,
) {
	ready := readiness.DeriveRuntimeReady(supervisorHandle.Snapshot(), runtimeReadinessMode)
	runtimeReadinessManager.SetReady(ready)
}

type RuntimeReadinessProjectionHandle struct {
	shutdown chan struct{}
	done     chan struct{}
	once     sync.Once
}

func SpawnRuntimeReadinessProjection(
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	runtimeReadinessManager *readiness.Manager,
	runtimeReadinessMode readiness.Mode,
	sleeper timeutil.Sleeper,
) *RuntimeReadinessProjectionHandle {
	handle := &RuntimeReadinessProjectionHandle{
		shutdown: make(chan struct{}),
		done:     make(chan struct{}),
	}
	go func() {
		defer close(handle.done)
		runRuntimeReadinessProjectionLoop(
			supervisorHandle,
			runtimeReadinessManager,
			runtimeReadinessMode,
			sleeper,
			handle.shutdown,
		)
	}()
	return handle
}

func (handle *RuntimeReadinessProjectionHandle) Close() {
	handle.once.Do(func() {
		close(handle.shutdown)
		<-handle.done
	})
}

func runRuntimeReadinessProjectionLoop(
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	runtimeReadinessManager *readiness.Manager,
	runtimeReadinessMode readiness.Mode,
	sleeper timeutil.Sleeper,
	shutdown <-chan struct{},
) {
	var lastProjectedReady *bool
	for {
		select {
		case <-shutdown:
			return
		default:
		}

		projectedReady := readiness.DeriveRuntimeReady(supervisorHandle.Snapshot(), runtimeReadinessMode)
		if lastProjectedReady == nil || *lastProjectedReady != projectedReady {
			runtimeReadinessManager.SetReady(projectedReady)
			ready := projectedReady
			lastProjectedReady = &ready
		}

		sleeper.Sleep(RuntimeReadinessProjectionPollInterval)
	}
}
