package process

import (
	"fmt"

	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

type RuntimeClientProcessManager struct {
	processes        []*RunningRuntimeClientProcess
	supervisorHandle *supervision.SandboxdSupervisorHandle
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
	if err := validateProcessManagerTiming(clock, sleeper); err != nil {
		return nil, err
	}
	if supervisorHandle == nil {
		return nil, fmt.Errorf("sandboxd supervisor handle is required")
	}
	startedProcesses := make([]*RunningRuntimeClientProcess, 0, len(processSpecs))

	for processIndex, processSpec := range processSpecs {
		markTrackedServerStarting(processSpec, supervisorHandle)

		process, err := StartRuntimeClientProcess(processSpec)
		if err != nil {
			_ = StopStartedProcesses(startedProcesses, clock, sleeper)
			return nil, startProcessError(processIndex, processSpec, err)
		}

		if err := WaitForRuntimeClientProcessReadiness(process, clock, sleeper); err != nil {
			_ = StopStartedProcesses(startedProcesses, clock, sleeper)
			_ = StopRuntimeClientProcess(process, clock, sleeper)
			return nil, readinessCheckError(processIndex, process, err)
		}

		markTrackedServerHealthy(process, supervisorHandle)
		startedProcesses = append(startedProcesses, process)
	}

	return &RuntimeClientProcessManager{
		processes:        startedProcesses,
		supervisorHandle: supervisorHandle,
	}, nil
}

func (manager *RuntimeClientProcessManager) Stop(clock timeutil.Clock, sleeper timeutil.Sleeper) error {
	if err := StopStartedProcesses(manager.processes, clock, sleeper); err != nil {
		return &ProcessManagerError{
			Kind:  ProcessManagerStopProcessesError,
			Cause: err,
		}
	}
	markTrackedServerStopped(manager.supervisorHandle)
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
