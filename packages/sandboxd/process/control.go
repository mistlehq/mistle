package process

import (
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

type managedRuntimeClientProcess struct {
	mutex   sync.Mutex
	process *RunningRuntimeClientProcess
}

type processRestartFailurePhase string

const (
	processRestartSpawnFailure     processRestartFailurePhase = "spawn"
	processRestartReadinessFailure processRestartFailurePhase = "readiness"
)

func (managed *managedRuntimeClientProcess) Spec() RuntimeClientProcessSpec {
	managed.mutex.Lock()
	defer managed.mutex.Unlock()
	return managed.process.Spec
}

func (managed *managedRuntimeClientProcess) Stop(clock timeutil.Clock, sleeper timeutil.Sleeper) error {
	managed.mutex.Lock()
	defer managed.mutex.Unlock()
	return StopRuntimeClientProcess(managed.process, clock, sleeper)
}

func (managed *managedRuntimeClientProcess) PID() uint32 {
	managed.mutex.Lock()
	defer managed.mutex.Unlock()
	return managed.process.PID()
}

func (managed *managedRuntimeClientProcess) ExitObservation() (processExitObservation, error) {
	managed.mutex.Lock()
	defer managed.mutex.Unlock()

	processID := managed.process.PID()
	exited, err := ProcessHasExited(managed.process)
	if err != nil {
		return processExitObservation{}, err
	}
	if !exited {
		return processExitObservation{PID: processID}, nil
	}
	reason, fields := processExitEventFields(managed.process)
	return processExitObservation{
		PID:         processID,
		Exited:      true,
		Description: processExitDescription(managed.process),
		Reason:      reason,
		Fields:      fields,
	}, nil
}

func (managed *managedRuntimeClientProcess) Restart(
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
) (*RunningRuntimeClientProcess, processRestartFailurePhase, error) {
	managed.mutex.Lock()
	defer managed.mutex.Unlock()

	processSpec := managed.process.Spec
	_ = StopRuntimeClientProcess(managed.process, clock, sleeper)

	replacementProcess, err := StartRuntimeClientProcess(processSpec)
	if err != nil {
		return nil, processRestartSpawnFailure, err
	}
	if err := WaitForRuntimeClientProcessReadiness(replacementProcess, clock, sleeper); err != nil {
		_ = StopRuntimeClientProcess(replacementProcess, clock, sleeper)
		return nil, processRestartReadinessFailure, err
	}

	managed.process = replacementProcess
	return replacementProcess, "", nil
}

type processExitObservation struct {
	PID         uint32
	Exited      bool
	Description string
	Reason      string
	Fields      map[string]any
}

type CodexAppServerObservationHandle struct {
	mutex       sync.Mutex
	observation CodexAppServerObservation
}

func NewCodexAppServerObservationHandle(
	processSpec RuntimeClientProcessSpec,
	pid uint32,
	isAlive bool,
	lastExitStatus *string,
) *CodexAppServerObservationHandle {
	observation := CodexAppServerObservation{}
	UpdateCodexAppServerObservation(&observation, processSpec, &pid, isAlive, lastExitStatus)
	return &CodexAppServerObservationHandle{observation: observation}
}

func (handle *CodexAppServerObservationHandle) Snapshot() CodexAppServerObservation {
	handle.mutex.Lock()
	defer handle.mutex.Unlock()
	return handle.observation
}

func (handle *CodexAppServerObservationHandle) Replace(
	processSpec RuntimeClientProcessSpec,
	pid uint32,
	isAlive bool,
	lastExitStatus *string,
) error {
	handle.mutex.Lock()
	defer handle.mutex.Unlock()
	return UpdateCodexAppServerObservation(&handle.observation, processSpec, &pid, isAlive, lastExitStatus)
}

type CodexAppServerControlHandle struct {
	managedProcess managedCodexAppServerProcess
}

type OpenCodeServerControlHandle struct {
	managedProcess managedOpenCodeServerProcess
}

type managedCodexAppServerProcess struct {
	process           *managedRuntimeClientProcess
	observation       *CodexAppServerObservationHandle
	supervisorHandle  *supervision.SandboxdSupervisorHandle
	restartMutex      sync.Mutex
	restartInProgress atomic.Bool
}

type managedOpenCodeServerProcess struct {
	process           *managedRuntimeClientProcess
	supervisorHandle  *supervision.SandboxdSupervisorHandle
	restartMutex      sync.Mutex
	restartInProgress atomic.Bool
}

func (handle *CodexAppServerControlHandle) ObservationHandle() *CodexAppServerObservationHandle {
	return handle.managedProcess.observation
}

func (handle *CodexAppServerControlHandle) Restart(clock timeutil.Clock, sleeper timeutil.Sleeper) error {
	if err := validateProcessManagerTiming(clock, sleeper); err != nil {
		return err
	}
	handle.managedProcess.restartMutex.Lock()
	defer handle.managedProcess.restartMutex.Unlock()

	handle.managedProcess.restartInProgress.Store(true)
	defer handle.managedProcess.restartInProgress.Store(false)

	handle.managedProcess.supervisorHandle.MarkComponentStarting(supervision.ComponentCodexAppServer)
	replacementProcess, failurePhase, err := handle.managedProcess.process.Restart(clock, sleeper)
	if err != nil {
		reason, probeKind, eventErr := codexRestartFailureEvent(failurePhase)
		if eventErr != nil {
			return eventErr
		}
		markRestartFailure(
			handle.managedProcess.supervisorHandle,
			supervision.ComponentCodexAppServer,
			err,
			reason,
			probeKind,
		)
		return err
	}

	processID := replacementProcess.PID()
	if err := handle.managedProcess.observation.Replace(replacementProcess.Spec, processID, true, nil); err != nil {
		return err
	}
	handle.managedProcess.supervisorHandle.ReplaceComponentDetails(
		supervision.ComponentCodexAppServer,
		CodexAppServerDetailsWithStatus(replacementProcess.Spec, &processID, nil, "Alive", "Ready"),
	)
	handle.managedProcess.supervisorHandle.MarkComponentHealthy(supervision.ComponentCodexAppServer)
	return nil
}

func (handle *OpenCodeServerControlHandle) Restart(clock timeutil.Clock, sleeper timeutil.Sleeper) error {
	if err := validateProcessManagerTiming(clock, sleeper); err != nil {
		return err
	}
	handle.managedProcess.restartMutex.Lock()
	defer handle.managedProcess.restartMutex.Unlock()

	handle.managedProcess.restartInProgress.Store(true)
	defer handle.managedProcess.restartInProgress.Store(false)

	handle.managedProcess.supervisorHandle.MarkComponentStarting(supervision.ComponentOpenCodeServer)
	replacementProcess, failurePhase, err := handle.managedProcess.process.Restart(clock, sleeper)
	if err != nil {
		reason, probeKind, eventErr := openCodeRestartFailureEvent(failurePhase)
		if eventErr != nil {
			return eventErr
		}
		markRestartFailure(
			handle.managedProcess.supervisorHandle,
			supervision.ComponentOpenCodeServer,
			err,
			reason,
			probeKind,
		)
		return err
	}

	processID := replacementProcess.PID()
	handle.managedProcess.supervisorHandle.ReplaceComponentDetails(
		supervision.ComponentOpenCodeServer,
		OpenCodeServerDetailsWithStatus(replacementProcess.Spec, &processID, nil, "Alive", "Ready"),
	)
	handle.managedProcess.supervisorHandle.MarkComponentHealthy(supervision.ComponentOpenCodeServer)
	return nil
}

func markRestartFailure(
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	component supervision.SupervisedComponent,
	cause error,
	reason string,
	probeKind string,
) {
	errorText := cause.Error()
	supervisorHandle.MarkComponentRestarting(component, errorText)
	supervisorHandle.EmitComponentHealthcheckFailed(
		component,
		reason,
		errorText,
		probeKind,
		map[string]any{},
	)
}

func codexRestartFailureEvent(failurePhase processRestartFailurePhase) (string, string, error) {
	switch failurePhase {
	case processRestartSpawnFailure:
		return "restart_spawn_failed", "process_liveness", nil
	case processRestartReadinessFailure:
		return "restart_readiness_failed", "readiness_ws", nil
	default:
		return "", "", fmt.Errorf("unsupported Codex app-server restart failure phase: %s", failurePhase)
	}
}

func openCodeRestartFailureEvent(failurePhase processRestartFailurePhase) (string, string, error) {
	switch failurePhase {
	case processRestartSpawnFailure:
		return "restart_spawn_failed", "process_liveness", nil
	case processRestartReadinessFailure:
		return "restart_readiness_failed", "readiness_http", nil
	default:
		return "", "", fmt.Errorf("unsupported OpenCode server restart failure phase: %s", failurePhase)
	}
}
