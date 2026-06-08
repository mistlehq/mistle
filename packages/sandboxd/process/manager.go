package process

import (
	"fmt"
	"strings"
	"sync"

	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

type RuntimeClientProcessManager struct {
	processes                   []*managedRuntimeClientProcess
	codexAppServerControlHandle *CodexAppServerControlHandle
	openCodeServerControlHandle *OpenCodeServerControlHandle
	supervisorHandle            *supervision.SandboxdSupervisorHandle
	monitorShutdown             chan struct{}
	monitorWaitGroup            sync.WaitGroup
	monitorStopOnce             sync.Once
}

type RuntimeClientProcessObserver interface {
	RecordProcessStarted(processSpec RuntimeClientProcessSpec)
	RecordProcessCompleted(processSpec RuntimeClientProcessSpec)
}

type ProcessManagerErrorKind string

const (
	ProcessManagerStartProcessError   ProcessManagerErrorKind = "start_process"
	ProcessManagerReadinessCheckError ProcessManagerErrorKind = "readiness_check"
	ProcessManagerStopProcessesError  ProcessManagerErrorKind = "stop_processes"
)

type ProcessManagerError struct {
	Kind               ProcessManagerErrorKind
	ProcessIndex       *int
	ProcessKey         string
	Cause              error
	ReadinessFailure   *ProcessReadinessFailureDetails
	ProcessOutputTails OutputTails
}

type ProcessReadinessFailureDetails struct {
	ReadinessType   string
	ReadinessTarget string
	TimeoutMS       uint64
	OutputTails     OutputTails
}

func (err *ProcessManagerError) Error() string {
	processIndex := -1
	if err.ProcessIndex != nil {
		processIndex = *err.ProcessIndex
	}
	switch err.Kind {
	case ProcessManagerStartProcessError:
		return fmt.Sprintf(
			"runtime client process[%d] failed to start (processKey=%s): %s",
			processIndex,
			err.ProcessKey,
			err.Cause.Error(),
		)
	case ProcessManagerReadinessCheckError:
		return fmt.Sprintf(
			"runtime client process[%d] readiness check failed (processKey=%s): %s",
			processIndex,
			err.ProcessKey,
			err.Cause.Error(),
		)
	case ProcessManagerStopProcessesError:
		return fmt.Sprintf("failed to stop runtime client processes: %s", err.Cause.Error())
	default:
		return err.Cause.Error()
	}
}

func (err *ProcessManagerError) Unwrap() error {
	return err.Cause
}

func StartRuntimeClientProcessManager(
	processSpecs []RuntimeClientProcessSpec,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
) (*RuntimeClientProcessManager, error) {
	if err := validateProcessManagerTiming(clock, sleeper); err != nil {
		return nil, err
	}
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-process-manager",
		timeutil.SystemClock{},
		nil,
	)
	if err != nil {
		return nil, err
	}
	return StartRuntimeClientProcessManagerWithSupervisor(processSpecs, clock, sleeper, supervisorHandle)
}

func StartRuntimeClientProcessManagerWithSupervisor(
	processSpecs []RuntimeClientProcessSpec,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
) (*RuntimeClientProcessManager, error) {
	return StartRuntimeClientProcessManagerWithSupervisorAndObserver(
		processSpecs,
		clock,
		sleeper,
		supervisorHandle,
		nil,
	)
}

func StartRuntimeClientProcessManagerWithSupervisorAndObserver(
	processSpecs []RuntimeClientProcessSpec,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	observer RuntimeClientProcessObserver,
) (*RuntimeClientProcessManager, error) {
	return startRuntimeClientProcessManagerWithSupervisorPlatformScopesAndObserver(
		processSpecs,
		clock,
		sleeper,
		supervisorHandle,
		nil,
		observer,
	)
}

func StartRuntimeClientProcessManagerWithPlatformScopes(
	processSpecs []RuntimeClientProcessSpec,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	platformScopeInput PlatformProcessScopeInput,
) (*RuntimeClientProcessManager, error) {
	return StartRuntimeClientProcessManagerWithPlatformScopesAndObserver(
		processSpecs,
		clock,
		sleeper,
		supervisorHandle,
		platformScopeInput,
		nil,
	)
}

func StartRuntimeClientProcessManagerWithPlatformScopesAndObserver(
	processSpecs []RuntimeClientProcessSpec,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	platformScopeInput PlatformProcessScopeInput,
	observer RuntimeClientProcessObserver,
) (*RuntimeClientProcessManager, error) {
	return startRuntimeClientProcessManagerWithSupervisorPlatformScopesAndObserver(
		processSpecs,
		clock,
		sleeper,
		supervisorHandle,
		&platformScopeInput,
		observer,
	)
}

func startRuntimeClientProcessManagerWithSupervisorPlatformScopesAndObserver(
	processSpecs []RuntimeClientProcessSpec,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	platformScopeInput *PlatformProcessScopeInput,
	observer RuntimeClientProcessObserver,
) (*RuntimeClientProcessManager, error) {
	if err := validateProcessManagerTiming(clock, sleeper); err != nil {
		return nil, err
	}
	if supervisorHandle == nil {
		return nil, fmt.Errorf("sandboxd supervisor handle is required")
	}
	startedProcesses := make([]*managedRuntimeClientProcess, 0, len(processSpecs))
	var codexAppServerControlHandle *CodexAppServerControlHandle
	var openCodeServerControlHandle *OpenCodeServerControlHandle

	for processIndex, processSpec := range processSpecs {
		markTrackedServerStarting(processSpec, supervisorHandle)
		if observer != nil {
			observer.RecordProcessStarted(processSpec)
		}

		var platformScope *runtimeClientProcessPlatformScope
		if platformScopeInput != nil {
			var err error
			platformScope, err = createRuntimeClientProcessPlatformScope(processIndex, processSpec, *platformScopeInput)
			if err != nil {
				_ = stopManagedRuntimeClientProcesses(startedProcesses, clock, sleeper)
				return nil, startProcessError(processIndex, processSpec, err)
			}
		}

		process, err := StartRuntimeClientProcess(processSpec)
		if err != nil {
			_ = killRuntimeClientProcessPlatformScope(platformScope)
			_ = stopManagedRuntimeClientProcesses(startedProcesses, clock, sleeper)
			return nil, startProcessError(processIndex, processSpec, err)
		}
		if err := attachRuntimeClientProcessPlatformScope(platformScope, process); err != nil {
			_ = StopRuntimeClientProcess(process, clock, sleeper)
			_ = killRuntimeClientProcessPlatformScope(platformScope)
			_ = stopManagedRuntimeClientProcesses(startedProcesses, clock, sleeper)
			return nil, startProcessError(processIndex, processSpec, err)
		}

		if err := WaitForRuntimeClientProcessReadiness(process, clock, sleeper); err != nil {
			_ = stopManagedRuntimeClientProcesses(startedProcesses, clock, sleeper)
			_ = StopRuntimeClientProcess(process, clock, sleeper)
			_ = killRuntimeClientProcessPlatformScope(platformScope)
			return nil, readinessCheckError(processIndex, process, err)
		}

		managedProcess := &managedRuntimeClientProcess{process: process, platformScope: platformScope}
		markTrackedServerHealthy(process, supervisorHandle)
		if IsCodexAppServerProcess(processSpec) &&
			supervisorHandle.TracksComponent(supervision.ComponentCodexAppServer) {
			observationHandle := NewCodexAppServerObservationHandle(processSpec, process.PID(), true, nil)
			codexAppServerControlHandle = &CodexAppServerControlHandle{
				managedProcess: managedCodexAppServerProcess{
					process:          managedProcess,
					observation:      observationHandle,
					supervisorHandle: supervisorHandle,
				},
			}
		}
		if IsOpenCodeServerProcess(processSpec) &&
			supervisorHandle.TracksComponent(supervision.ComponentOpenCodeServer) {
			openCodeServerControlHandle = &OpenCodeServerControlHandle{
				managedProcess: managedOpenCodeServerProcess{
					process:          managedProcess,
					supervisorHandle: supervisorHandle,
				},
			}
		}
		startedProcesses = append(startedProcesses, managedProcess)
		if observer != nil {
			observer.RecordProcessCompleted(processSpec)
		}
	}

	manager := &RuntimeClientProcessManager{
		processes:                   startedProcesses,
		codexAppServerControlHandle: codexAppServerControlHandle,
		openCodeServerControlHandle: openCodeServerControlHandle,
		supervisorHandle:            supervisorHandle,
		monitorShutdown:             make(chan struct{}),
	}
	manager.startProcessMonitors()
	return manager, nil
}

func (manager *RuntimeClientProcessManager) Stop(clock timeutil.Clock, sleeper timeutil.Sleeper) error {
	manager.stopProcessMonitors()
	if err := stopManagedRuntimeClientProcesses(manager.processes, clock, sleeper); err != nil {
		return &ProcessManagerError{
			Kind:  ProcessManagerStopProcessesError,
			Cause: err,
		}
	}
	markTrackedServerStopped(manager.supervisorHandle)
	return nil
}

func (manager *RuntimeClientProcessManager) CodexAppServerControlHandle() *CodexAppServerControlHandle {
	return manager.codexAppServerControlHandle
}

func (manager *RuntimeClientProcessManager) OpenCodeServerControlHandle() *OpenCodeServerControlHandle {
	return manager.openCodeServerControlHandle
}

func (manager *RuntimeClientProcessManager) startProcessMonitors() {
	if manager.codexAppServerControlHandle != nil {
		manager.monitorWaitGroup.Add(1)
		go func() {
			defer manager.monitorWaitGroup.Done()
			runCodexAppServerMonitor(manager.codexAppServerControlHandle, manager.monitorShutdown)
		}()
	}
	if manager.openCodeServerControlHandle != nil {
		manager.monitorWaitGroup.Add(1)
		go func() {
			defer manager.monitorWaitGroup.Done()
			runOpenCodeServerMonitor(manager.openCodeServerControlHandle, manager.monitorShutdown)
		}()
	}
}

func (manager *RuntimeClientProcessManager) stopProcessMonitors() {
	manager.monitorStopOnce.Do(func() {
		close(manager.monitorShutdown)
	})
	manager.monitorWaitGroup.Wait()
}

func stopManagedRuntimeClientProcesses(
	processes []*managedRuntimeClientProcess,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
) error {
	stopErrors := make([]string, 0)
	for index := len(processes) - 1; index >= 0; index-- {
		process := processes[index]
		if err := process.Stop(clock, sleeper); err != nil {
			processSpec := process.Spec()
			stopErrors = append(stopErrors, fmt.Sprintf("processKey=%s: %s", processSpec.ProcessKey, err.Error()))
		}
	}
	if len(stopErrors) > 0 {
		return fmt.Errorf("%s", strings.Join(stopErrors, "; "))
	}
	return nil
}

func markTrackedServerStarting(
	processSpec RuntimeClientProcessSpec,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
) {
	if IsCodexAppServerProcess(processSpec) &&
		supervisorHandle.TracksComponent(supervision.ComponentCodexAppServer) {
		supervisorHandle.ReplaceComponentDetails(
			supervision.ComponentCodexAppServer,
			CodexAppServerDetailsWithStatus(processSpec, nil, nil, "Starting", "Starting"),
		)
		supervisorHandle.MarkComponentStarting(supervision.ComponentCodexAppServer)
	}
	if IsOpenCodeServerProcess(processSpec) &&
		supervisorHandle.TracksComponent(supervision.ComponentOpenCodeServer) {
		supervisorHandle.ReplaceComponentDetails(
			supervision.ComponentOpenCodeServer,
			OpenCodeServerDetailsWithStatus(processSpec, nil, nil, "Starting", "Starting"),
		)
		supervisorHandle.MarkComponentStarting(supervision.ComponentOpenCodeServer)
	}
}

func markTrackedServerHealthy(
	process *RunningRuntimeClientProcess,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
) {
	processID := process.PID()
	if IsCodexAppServerProcess(process.Spec) &&
		supervisorHandle.TracksComponent(supervision.ComponentCodexAppServer) {
		supervisorHandle.ReplaceComponentDetails(
			supervision.ComponentCodexAppServer,
			CodexAppServerDetailsWithStatus(process.Spec, &processID, nil, "Alive", "Ready"),
		)
		supervisorHandle.MarkComponentHealthy(supervision.ComponentCodexAppServer)
	}
	if IsOpenCodeServerProcess(process.Spec) &&
		supervisorHandle.TracksComponent(supervision.ComponentOpenCodeServer) {
		supervisorHandle.ReplaceComponentDetails(
			supervision.ComponentOpenCodeServer,
			OpenCodeServerDetailsWithStatus(process.Spec, &processID, nil, "Alive", "Ready"),
		)
		supervisorHandle.MarkComponentHealthy(supervision.ComponentOpenCodeServer)
	}
}

func markTrackedServerStopped(supervisorHandle *supervision.SandboxdSupervisorHandle) {
	if supervisorHandle.TracksComponent(supervision.ComponentCodexAppServer) {
		supervisorHandle.MarkComponentStopped(supervision.ComponentCodexAppServer)
	}
	if supervisorHandle.TracksComponent(supervision.ComponentOpenCodeServer) {
		supervisorHandle.MarkComponentStopped(supervision.ComponentOpenCodeServer)
	}
}

func startProcessError(
	processIndex int,
	processSpec RuntimeClientProcessSpec,
	cause error,
) *ProcessManagerError {
	return &ProcessManagerError{
		Kind:               ProcessManagerStartProcessError,
		ProcessIndex:       &processIndex,
		ProcessKey:         processSpec.ProcessKey,
		Cause:              cause,
		ProcessOutputTails: OutputTails{},
	}
}

func readinessCheckError(
	processIndex int,
	process *RunningRuntimeClientProcess,
	cause error,
) *ProcessManagerError {
	outputTails := process.OutputCapture().CollectTailsAfterProcessExit()
	return &ProcessManagerError{
		Kind:         ProcessManagerReadinessCheckError,
		ProcessIndex: &processIndex,
		ProcessKey:   process.Spec.ProcessKey,
		Cause:        cause,
		ReadinessFailure: &ProcessReadinessFailureDetails{
			ReadinessType:   ReadinessType(process.Spec),
			ReadinessTarget: ReadinessTarget(process.Spec),
			TimeoutMS:       ReadinessTimeoutMS(process.Spec),
			OutputTails:     outputTails,
		},
		ProcessOutputTails: outputTails,
	}
}

func validateProcessManagerTiming(clock timeutil.Clock, sleeper timeutil.Sleeper) error {
	if clock == nil {
		return fmt.Errorf("process manager clock is required")
	}
	if sleeper == nil {
		return fmt.Errorf("process manager sleeper is required")
	}
	return nil
}
