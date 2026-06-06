package process

import (
	"fmt"
	"time"

	"github.com/mistle/sandboxd/supervision"
)

type runtimeClientProcessMonitorState struct {
	lastReadinessOK              bool
	lastReportedExitPID          *uint32
	consecutiveReadinessFailures uint8
}

func newRuntimeClientProcessMonitorState() runtimeClientProcessMonitorState {
	return runtimeClientProcessMonitorState{lastReadinessOK: true}
}

func runCodexAppServerMonitor(
	controlHandle *CodexAppServerControlHandle,
	shutdown <-chan struct{},
) {
	state := newRuntimeClientProcessMonitorState()
	runRuntimeClientProcessMonitor(shutdown, func() error {
		return observeCodexAppServerProcess(controlHandle, &state)
	})
}

func runOpenCodeServerMonitor(
	controlHandle *OpenCodeServerControlHandle,
	shutdown <-chan struct{},
) {
	state := newRuntimeClientProcessMonitorState()
	runRuntimeClientProcessMonitor(shutdown, func() error {
		return observeOpenCodeServerProcess(controlHandle, &state)
	})
}

func runRuntimeClientProcessMonitor(shutdown <-chan struct{}, observe func() error) {
	for {
		select {
		case <-shutdown:
			return
		default:
		}

		_ = observe()

		timer := time.NewTimer(DefaultProcessMonitorPollInterval)
		select {
		case <-shutdown:
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func observeCodexAppServerProcess(
	controlHandle *CodexAppServerControlHandle,
	state *runtimeClientProcessMonitorState,
) error {
	if controlHandle.managedProcess.restartInProgress.Load() {
		return nil
	}

	processSpec := controlHandle.managedProcess.process.Spec()
	exitObservation, err := controlHandle.managedProcess.process.ExitObservation()
	if err != nil {
		return err
	}
	if exitObservation.Exited {
		return recordCodexAppServerExit(controlHandle, state, processSpec, exitObservation)
	}
	state.lastReportedExitPID = nil

	readinessErr := CheckCodexAppServerPostStartReadiness(processSpec)
	if readinessErr == nil {
		processID := exitObservation.PID
		if err := controlHandle.managedProcess.observation.Replace(processSpec, processID, true, nil); err != nil {
			return err
		}
		controlHandle.managedProcess.supervisorHandle.ReplaceComponentDetails(
			supervision.ComponentCodexAppServer,
			CodexAppServerDetailsWithStatus(processSpec, &processID, nil, "Alive", "Ready"),
		)
		if !state.lastReadinessOK {
			controlHandle.managedProcess.supervisorHandle.MarkComponentHealthy(supervision.ComponentCodexAppServer)
		}
		controlHandle.managedProcess.supervisorHandle.RecordComponentHealthcheck(supervision.ComponentCodexAppServer)
		state.consecutiveReadinessFailures = 0
		state.lastReadinessOK = true
		return nil
	}

	processID := exitObservation.PID
	if err := controlHandle.managedProcess.observation.Replace(processSpec, processID, true, nil); err != nil {
		return err
	}
	return recordRuntimeClientReadinessFailure(
		controlHandle.managedProcess.supervisorHandle,
		supervision.ComponentCodexAppServer,
		processSpec,
		&processID,
		readinessErr,
		state,
		CodexAppServerFailureThreshold,
		"readiness_http_readyz",
		CodexAppServerDetailsWithStatus,
	)
}

func observeOpenCodeServerProcess(
	controlHandle *OpenCodeServerControlHandle,
	state *runtimeClientProcessMonitorState,
) error {
	if controlHandle.managedProcess.restartInProgress.Load() {
		return nil
	}

	processSpec := controlHandle.managedProcess.process.Spec()
	exitObservation, err := controlHandle.managedProcess.process.ExitObservation()
	if err != nil {
		return err
	}
	if exitObservation.Exited {
		return recordOpenCodeServerExit(controlHandle, state, processSpec, exitObservation)
	}
	state.lastReportedExitPID = nil

	readinessErr := CheckRuntimeClientProcessReadinessFromSpec(processSpec)
	if readinessErr == nil {
		processID := exitObservation.PID
		controlHandle.managedProcess.supervisorHandle.ReplaceComponentDetails(
			supervision.ComponentOpenCodeServer,
			OpenCodeServerDetailsWithStatus(processSpec, &processID, nil, "Alive", "Ready"),
		)
		if !state.lastReadinessOK {
			controlHandle.managedProcess.supervisorHandle.MarkComponentHealthy(supervision.ComponentOpenCodeServer)
		}
		controlHandle.managedProcess.supervisorHandle.RecordComponentHealthcheck(supervision.ComponentOpenCodeServer)
		state.consecutiveReadinessFailures = 0
		state.lastReadinessOK = true
		return nil
	}

	processID := exitObservation.PID
	return recordRuntimeClientReadinessFailure(
		controlHandle.managedProcess.supervisorHandle,
		supervision.ComponentOpenCodeServer,
		processSpec,
		&processID,
		readinessErr,
		state,
		OpenCodeServerFailureThreshold,
		"readiness_http",
		OpenCodeServerDetailsWithStatus,
	)
}

func recordCodexAppServerExit(
	controlHandle *CodexAppServerControlHandle,
	state *runtimeClientProcessMonitorState,
	processSpec RuntimeClientProcessSpec,
	exitObservation processExitObservation,
) error {
	if state.lastReportedExitPID != nil && *state.lastReportedExitPID == exitObservation.PID {
		return nil
	}
	processID := exitObservation.PID
	if err := controlHandle.managedProcess.observation.Replace(
		processSpec,
		processID,
		false,
		&exitObservation.Description,
	); err != nil {
		return err
	}
	recordRuntimeClientExit(
		controlHandle.managedProcess.supervisorHandle,
		supervision.ComponentCodexAppServer,
		processSpec,
		&processID,
		exitObservation,
		state,
		CodexAppServerDetailsWithStatus,
	)
	return nil
}

func recordOpenCodeServerExit(
	controlHandle *OpenCodeServerControlHandle,
	state *runtimeClientProcessMonitorState,
	processSpec RuntimeClientProcessSpec,
	exitObservation processExitObservation,
) error {
	if state.lastReportedExitPID != nil && *state.lastReportedExitPID == exitObservation.PID {
		return nil
	}
	processID := exitObservation.PID
	recordRuntimeClientExit(
		controlHandle.managedProcess.supervisorHandle,
		supervision.ComponentOpenCodeServer,
		processSpec,
		&processID,
		exitObservation,
		state,
		OpenCodeServerDetailsWithStatus,
	)
	return nil
}

func recordRuntimeClientExit(
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	component supervision.SupervisedComponent,
	processSpec RuntimeClientProcessSpec,
	processID *uint32,
	exitObservation processExitObservation,
	state *runtimeClientProcessMonitorState,
	detailsWithStatus func(RuntimeClientProcessSpec, *uint32, *string, string, string) map[string]string,
) {
	readinessState := "Unreachable"
	if state.lastReadinessOK {
		readinessState = "Ready"
	}
	supervisorHandle.ReplaceComponentDetails(
		component,
		detailsWithStatus(processSpec, processID, &exitObservation.Description, "Exited", readinessState),
	)
	supervisorHandle.MarkComponentRestarting(component, exitObservation.Description)
	supervisorHandle.EmitComponentExited(
		component,
		exitObservation.Reason,
		&exitObservation.Description,
		exitObservation.Fields,
	)
	state.lastReportedExitPID = processID
	state.lastReadinessOK = false
}

func recordRuntimeClientReadinessFailure(
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	component supervision.SupervisedComponent,
	processSpec RuntimeClientProcessSpec,
	processID *uint32,
	readinessErr error,
	state *runtimeClientProcessMonitorState,
	failureThreshold uint8,
	probeKind string,
	detailsWithStatus func(RuntimeClientProcessSpec, *uint32, *string, string, string) map[string]string,
) error {
	state.consecutiveReadinessFailures = saturatingIncrementUint8(state.consecutiveReadinessFailures)
	readinessState := "Degraded"
	if state.consecutiveReadinessFailures >= failureThreshold {
		readinessState = "Unreachable"
	}
	supervisorHandle.ReplaceComponentDetails(
		component,
		detailsWithStatus(processSpec, processID, nil, "Alive", readinessState),
	)
	if state.lastReadinessOK && state.consecutiveReadinessFailures >= failureThreshold {
		errorText := readinessErr.Error()
		supervisorHandle.MarkComponentRestarting(component, errorText)
		supervisorHandle.EmitComponentHealthcheckFailed(
			component,
			"readiness_probe_failed",
			errorText,
			probeKind,
			map[string]any{
				"consecutiveFailures": fmt.Sprint(state.consecutiveReadinessFailures),
				"failureThreshold":    fmt.Sprint(failureThreshold),
			},
		)
	}
	state.lastReadinessOK = state.consecutiveReadinessFailures < failureThreshold
	return nil
}

func saturatingIncrementUint8(value uint8) uint8 {
	if value == ^uint8(0) {
		return value
	}
	return value + 1
}
