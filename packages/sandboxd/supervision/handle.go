package supervision

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"sync"
	"time"

	"github.com/mistle/sandboxd/timeutil"
)

const MaxForwardedLifecycleEventLines = 128

type LifecycleEventName string

const (
	LifecycleEventComponentStarting          LifecycleEventName = "component_starting"
	LifecycleEventComponentStarted           LifecycleEventName = "component_started"
	LifecycleEventComponentHealthcheckFailed LifecycleEventName = "component_healthcheck_failed"
	LifecycleEventComponentExited            LifecycleEventName = "component_exited"
	LifecycleEventComponentRestartScheduled  LifecycleEventName = "component_restart_scheduled"
	LifecycleEventComponentRestartSucceeded  LifecycleEventName = "component_restart_succeeded"
	LifecycleEventDaemonLivenessLagDetected  LifecycleEventName = "daemon_liveness_lag_detected"
	LifecycleEventDaemonLivenessRecovered    LifecycleEventName = "daemon_liveness_recovered"
)

type SandboxdSupervisorHandle struct {
	sandboxInstanceID string
	clock             timeutil.Clock
	state             *supervisorState
}

type supervisorState struct {
	mutex                   sync.Mutex
	componentsByName        map[SupervisedComponent]ComponentHealthSnapshot
	componentOrder          []SupervisedComponent
	forwardedLifecycleLines []string
	observedAt              time.Time
}

type lifecycleEventEmission struct {
	observedAt  time.Time
	event       LifecycleEventName
	reason      *string
	errorText   *string
	extraFields map[string]any
}

func NewSandboxdSupervisorHandle(
	sandboxInstanceID string,
	clock timeutil.Clock,
	trackedComponents []SupervisedComponent,
) (*SandboxdSupervisorHandle, error) {
	if clock == nil {
		return nil, fmt.Errorf("sandboxd supervisor clock is required")
	}
	observedAt := clock.NowSystemTime()
	componentsByName := make(map[SupervisedComponent]ComponentHealthSnapshot, len(trackedComponents))
	componentOrder := make([]SupervisedComponent, 0, len(trackedComponents))
	for _, component := range trackedComponents {
		if _, exists := componentsByName[component]; exists {
			continue
		}
		componentsByName[component] = ComponentHealthSnapshot{
			Component: component,
			State:     ComponentStopped,
			Details:   map[string]string{},
		}
		componentOrder = append(componentOrder, component)
	}

	return &SandboxdSupervisorHandle{
		sandboxInstanceID: sandboxInstanceID,
		clock:             clock,
		state: &supervisorState{
			componentsByName: componentsByName,
			componentOrder:   componentOrder,
			observedAt:       observedAt,
		},
	}, nil
}

func (handle *SandboxdSupervisorHandle) SandboxInstanceID() string {
	return handle.sandboxInstanceID
}

func (handle *SandboxdSupervisorHandle) TracksComponent(component SupervisedComponent) bool {
	handle.state.mutex.Lock()
	defer handle.state.mutex.Unlock()
	_, ok := handle.state.componentsByName[component]
	return ok
}

func (handle *SandboxdSupervisorHandle) Snapshot() HealthSnapshot {
	handle.state.mutex.Lock()
	defer handle.state.mutex.Unlock()

	components := make([]ComponentHealthSnapshot, 0, len(handle.state.componentOrder))
	for _, component := range handle.state.componentOrder {
		components = append(components, cloneComponentSnapshot(handle.state.componentsByName[component]))
	}
	return HealthSnapshot{ObservedAt: handle.state.observedAt, Components: components}
}

func (handle *SandboxdSupervisorHandle) ComponentSnapshot(component SupervisedComponent) *ComponentHealthSnapshot {
	handle.state.mutex.Lock()
	defer handle.state.mutex.Unlock()

	snapshot, ok := handle.state.componentsByName[component]
	if !ok {
		return nil
	}
	cloned := cloneComponentSnapshot(snapshot)
	return &cloned
}

func (handle *SandboxdSupervisorHandle) RestoreComponentSnapshot(snapshot ComponentHealthSnapshot) {
	handle.updateComponent(snapshot.Component, func(current *ComponentHealthSnapshot, _ time.Time) any {
		*current = cloneComponentSnapshot(snapshot)
		return nil
	})
}

func (handle *SandboxdSupervisorHandle) MarkComponentStarting(component SupervisedComponent) {
	result := handle.updateComponent(component, func(snapshot *ComponentHealthSnapshot, _ time.Time) any {
		isRestartAttempt := snapshot.State == ComponentRestarting
		if !isRestartAttempt {
			snapshot.State = ComponentStarting
			snapshot.LastError = nil
		}
		return isRestartAttempt
	})
	if result == nil {
		return
	}

	reason := "initial_start"
	if result.updateResult.(bool) {
		reason = "restart_attempt"
	}
	handle.emitLifecycleEventFromSnapshot(result.snapshot, lifecycleEventEmission{
		observedAt: result.observedAt,
		event:      LifecycleEventComponentStarting,
		reason:     &reason,
	})
}

func (handle *SandboxdSupervisorHandle) MarkComponentHealthy(component SupervisedComponent) {
	result := handle.updateComponent(component, func(snapshot *ComponentHealthSnapshot, observedAt time.Time) any {
		snapshot.State = ComponentHealthy
		snapshot.LastStartedAt = &observedAt
		snapshot.LastHealthcheckAt = &observedAt
		snapshot.LastError = nil
		return nil
	})
	if result == nil {
		return
	}

	switch result.previousState {
	case ComponentStarting:
		handle.emitLifecycleEventFromSnapshot(result.snapshot, lifecycleEventEmission{
			observedAt: result.observedAt,
			event:      LifecycleEventComponentStarted,
		})
	case ComponentRestarting:
		reason := "restart_succeeded"
		handle.emitLifecycleEventFromSnapshot(result.snapshot, lifecycleEventEmission{
			observedAt: result.observedAt,
			event:      LifecycleEventComponentRestartSucceeded,
			reason:     &reason,
		})
	case ComponentHealthy, ComponentStopped:
	}
}

func (handle *SandboxdSupervisorHandle) MarkComponentStopped(component SupervisedComponent) {
	handle.updateComponent(component, func(snapshot *ComponentHealthSnapshot, _ time.Time) any {
		snapshot.State = ComponentStopped
		snapshot.LastError = nil
		return nil
	})
}

func (handle *SandboxdSupervisorHandle) MarkComponentRestarting(component SupervisedComponent, errorText string) {
	handle.updateComponent(component, func(snapshot *ComponentHealthSnapshot, observedAt time.Time) any {
		snapshot.State = ComponentRestarting
		snapshot.RestartCount++
		snapshot.LastFailedAt = &observedAt
		snapshot.LastError = &errorText
		return nil
	})
}

func (handle *SandboxdSupervisorHandle) RecordComponentHealthcheck(component SupervisedComponent) {
	handle.updateComponent(component, func(snapshot *ComponentHealthSnapshot, observedAt time.Time) any {
		snapshot.LastHealthcheckAt = &observedAt
		return nil
	})
}

func (handle *SandboxdSupervisorHandle) ReplaceComponentDetails(component SupervisedComponent, details map[string]string) {
	handle.updateComponent(component, func(snapshot *ComponentHealthSnapshot, _ time.Time) any {
		snapshot.Details = cloneDetails(details)
		return nil
	})
}

func (handle *SandboxdSupervisorHandle) SetComponentDetail(component SupervisedComponent, key string, value string) {
	handle.updateComponent(component, func(snapshot *ComponentHealthSnapshot, _ time.Time) any {
		snapshot.Details[key] = value
		return nil
	})
}

func (handle *SandboxdSupervisorHandle) RemoveComponentDetail(component SupervisedComponent, key string) {
	handle.updateComponent(component, func(snapshot *ComponentHealthSnapshot, _ time.Time) any {
		delete(snapshot.Details, key)
		return nil
	})
}

func (handle *SandboxdSupervisorHandle) ClearComponentDetails(component SupervisedComponent) {
	handle.updateComponent(component, func(snapshot *ComponentHealthSnapshot, _ time.Time) any {
		snapshot.Details = map[string]string{}
		return nil
	})
}

func (handle *SandboxdSupervisorHandle) EmitComponentHealthcheckFailed(
	component SupervisedComponent,
	reason string,
	errorText string,
	probeKind string,
	extraFields map[string]any,
) {
	fields := cloneAnyMap(extraFields)
	fields["probeKind"] = probeKind
	handle.emitComponentLifecycleEvent(LifecycleEventComponentHealthcheckFailed, component, &reason, &errorText, fields)
}

func (handle *SandboxdSupervisorHandle) EmitComponentExited(
	component SupervisedComponent,
	reason string,
	errorText *string,
	extraFields map[string]any,
) {
	handle.emitComponentLifecycleEvent(LifecycleEventComponentExited, component, &reason, errorText, extraFields)
}

func (handle *SandboxdSupervisorHandle) EmitComponentRestartScheduled(
	component SupervisedComponent,
	reason string,
	backoffMS uint64,
	extraFields map[string]any,
) {
	fields := cloneAnyMap(extraFields)
	fields["backoffMs"] = backoffMS
	handle.emitComponentLifecycleEvent(LifecycleEventComponentRestartScheduled, component, &reason, nil, fields)
}

func (handle *SandboxdSupervisorHandle) DrainForwardedLifecycleEventLines() []string {
	handle.state.mutex.Lock()
	defer handle.state.mutex.Unlock()

	lines := append([]string(nil), handle.state.forwardedLifecycleLines...)
	handle.state.forwardedLifecycleLines = nil
	return lines
}

func (handle *SandboxdSupervisorHandle) RecordDaemonLivenessSample(details map[string]string) {
	handle.updateComponent(ComponentSandboxd, func(snapshot *ComponentHealthSnapshot, observedAt time.Time) any {
		if snapshot.State != ComponentRestarting {
			snapshot.State = ComponentHealthy
			snapshot.LastError = nil
		}
		snapshot.LastHealthcheckAt = &observedAt
		replaceDaemonLivenessDetails(snapshot, details)
		return nil
	})
}

func (handle *SandboxdSupervisorHandle) RecordDaemonLivenessLagDetected(
	details map[string]string,
	lagMS uint64,
	thresholdMS uint64,
) {
	errorText := fmt.Sprintf("sandboxd liveness sampler was delayed by %dms, above %dms threshold", lagMS, thresholdMS)
	result := handle.updateComponent(ComponentSandboxd, func(snapshot *ComponentHealthSnapshot, observedAt time.Time) any {
		snapshot.State = ComponentRestarting
		snapshot.LastFailedAt = &observedAt
		snapshot.LastHealthcheckAt = &observedAt
		snapshot.LastError = &errorText
		replaceDaemonLivenessDetails(snapshot, details)
		return nil
	})
	if result == nil {
		return
	}

	reason := "sampler_tick_lag"
	handle.emitLifecycleEventFromSnapshot(result.snapshot, lifecycleEventEmission{
		observedAt: result.observedAt,
		event:      LifecycleEventDaemonLivenessLagDetected,
		reason:     &reason,
		errorText:  &errorText,
		extraFields: map[string]any{
			"lagMs":       lagMS,
			"thresholdMs": thresholdMS,
		},
	})
}

func (handle *SandboxdSupervisorHandle) RecordDaemonLivenessRecovered(
	details map[string]string,
	lagMS uint64,
	thresholdMS uint64,
) {
	result := handle.updateComponent(ComponentSandboxd, func(snapshot *ComponentHealthSnapshot, observedAt time.Time) any {
		snapshot.State = ComponentHealthy
		snapshot.LastHealthcheckAt = &observedAt
		snapshot.LastError = nil
		replaceDaemonLivenessDetails(snapshot, details)
		return nil
	})
	if result == nil {
		return
	}

	reason := "sampler_tick_recovered"
	handle.emitLifecycleEventFromSnapshot(result.snapshot, lifecycleEventEmission{
		observedAt: result.observedAt,
		event:      LifecycleEventDaemonLivenessRecovered,
		reason:     &reason,
		extraFields: map[string]any{
			"lagMs":       lagMS,
			"thresholdMs": thresholdMS,
		},
	})
}

type componentUpdateResult struct {
	updateResult  any
	snapshot      ComponentHealthSnapshot
	previousState ComponentHealthState
	observedAt    time.Time
}

func (handle *SandboxdSupervisorHandle) updateComponent(
	component SupervisedComponent,
	update func(*ComponentHealthSnapshot, time.Time) any,
) *componentUpdateResult {
	observedAt := handle.clock.NowSystemTime()
	handle.state.mutex.Lock()
	defer handle.state.mutex.Unlock()

	snapshot, ok := handle.state.componentsByName[component]
	if !ok {
		return nil
	}
	previousState := snapshot.State
	updateResult := update(&snapshot, observedAt)
	snapshot = cloneComponentSnapshot(snapshot)
	handle.state.componentsByName[component] = snapshot
	handle.state.observedAt = observedAt
	return &componentUpdateResult{
		updateResult:  updateResult,
		snapshot:      snapshot,
		previousState: previousState,
		observedAt:    observedAt,
	}
}

func (handle *SandboxdSupervisorHandle) emitComponentLifecycleEvent(
	event LifecycleEventName,
	component SupervisedComponent,
	reason *string,
	errorText *string,
	extraFields map[string]any,
) {
	context := handle.componentEventContext(component)
	if context == nil {
		return
	}
	handle.emitLifecycleEventFromSnapshot(context.snapshot, lifecycleEventEmission{
		observedAt:  context.observedAt,
		event:       event,
		reason:      reason,
		errorText:   errorText,
		extraFields: extraFields,
	})
}

type componentEventContext struct {
	snapshot   ComponentHealthSnapshot
	observedAt time.Time
}

func (handle *SandboxdSupervisorHandle) componentEventContext(component SupervisedComponent) *componentEventContext {
	handle.state.mutex.Lock()
	defer handle.state.mutex.Unlock()

	snapshot, ok := handle.state.componentsByName[component]
	if !ok {
		return nil
	}
	return &componentEventContext{
		snapshot:   cloneComponentSnapshot(snapshot),
		observedAt: handle.state.observedAt,
	}
}

func (handle *SandboxdSupervisorHandle) emitLifecycleEventFromSnapshot(snapshot ComponentHealthSnapshot, emission lifecycleEventEmission) {
	line, err := serializeLifecycleEventLine(handle.sandboxInstanceID, snapshot, emission)
	if err != nil {
		return
	}

	_, _ = fmt.Fprint(os.Stderr, line)

	handle.state.mutex.Lock()
	defer handle.state.mutex.Unlock()
	if len(handle.state.forwardedLifecycleLines) == MaxForwardedLifecycleEventLines {
		handle.state.forwardedLifecycleLines = handle.state.forwardedLifecycleLines[1:]
	}
	handle.state.forwardedLifecycleLines = append(handle.state.forwardedLifecycleLines, line)
}

func serializeLifecycleEventLine(
	sandboxInstanceID string,
	snapshot ComponentHealthSnapshot,
	emission lifecycleEventEmission,
) (string, error) {
	payload := map[string]any{
		"event":             string(emission.event),
		"sandboxInstanceId": sandboxInstanceID,
		"component":         string(snapshot.Component),
		"state":             string(snapshot.State),
		"observedAt":        timeutil.FormatRFC3339Timestamp(emission.observedAt),
		"restartCount":      snapshot.RestartCount,
	}
	if emission.reason != nil {
		payload["reason"] = *emission.reason
	}
	if emission.errorText != nil {
		payload["error"] = *emission.errorText
	}
	for _, fieldName := range snapshotDetailFieldNamesForEvent(snapshot.Component, emission.event) {
		value, ok := snapshot.Details[fieldName]
		if ok {
			payload[fieldName] = value
		}
	}
	for fieldName, fieldValue := range emission.extraFields {
		payload[fieldName] = fieldValue
	}

	bytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(bytes) + "\n", nil
}

func replaceDaemonLivenessDetails(snapshot *ComponentHealthSnapshot, details map[string]string) {
	replacement := cloneDetails(details)
	if errorText, ok := snapshot.Details[DaemonLivenessJournalErrorDetail]; ok {
		replacement[DaemonLivenessJournalErrorDetail] = errorText
	}
	snapshot.Details = replacement
}

func cloneComponentSnapshot(snapshot ComponentHealthSnapshot) ComponentHealthSnapshot {
	snapshot.Details = cloneDetails(snapshot.Details)
	return snapshot
}

func cloneDetails(source map[string]string) map[string]string {
	target := make(map[string]string, len(source))
	for key, value := range source {
		target[key] = value
	}
	return target
}

func cloneAnyMap(source map[string]any) map[string]any {
	target := make(map[string]any, len(source))
	for key, value := range source {
		target[key] = value
	}
	return target
}

func snapshotDetailFieldNamesForEvent(component SupervisedComponent, event LifecycleEventName) []string {
	switch {
	case component == ComponentSandboxd && (event == LifecycleEventDaemonLivenessLagDetected || event == LifecycleEventDaemonLivenessRecovered):
		return []string{
			"samplerIntervalMs",
			"lagThresholdMs",
			"lastLagMs",
			"maxLagMs",
			"pid",
			"rssBytes",
			"threadCount",
			"fdCount",
			"cgroupMemoryCurrentBytes",
			"cgroupMemoryOomEvents",
			"cgroupMemoryOomKillEvents",
			"resourceProbeError",
		}
	case component == ComponentTunnelSession && lifecycleEventIn(event,
		LifecycleEventComponentStarting,
		LifecycleEventComponentStarted,
		LifecycleEventComponentHealthcheckFailed,
		LifecycleEventComponentRestartScheduled,
		LifecycleEventComponentRestartSucceeded,
	):
		return []string{"gatewayWsUrl"}
	case component == ComponentEgressProxy && lifecycleEventIn(event,
		LifecycleEventComponentStarting,
		LifecycleEventComponentStarted,
		LifecycleEventComponentHealthcheckFailed,
		LifecycleEventComponentExited,
		LifecycleEventComponentRestartScheduled,
		LifecycleEventComponentRestartSucceeded,
	):
		return []string{"listenAddr", "stablePort", "runtimeMode", "childBinary", "childPid"}
	case (component == ComponentCodexProxy || component == ComponentOpenCodeProxy) && lifecycleEventIn(event,
		LifecycleEventComponentStarting,
		LifecycleEventComponentStarted,
		LifecycleEventComponentHealthcheckFailed,
		LifecycleEventComponentExited,
		LifecycleEventComponentRestartScheduled,
		LifecycleEventComponentRestartSucceeded,
	):
		return []string{"listenAddr", "rawTarget"}
	case (component == ComponentOpenCodeServer || component == ComponentCodexAppServer) && lifecycleEventIn(event,
		LifecycleEventComponentStarting,
		LifecycleEventComponentRestartScheduled,
	):
		return []string{"processKey", "readinessUrl"}
	case (component == ComponentOpenCodeServer || component == ComponentCodexAppServer) && lifecycleEventIn(event,
		LifecycleEventComponentStarted,
		LifecycleEventComponentRestartSucceeded,
		LifecycleEventComponentHealthcheckFailed,
	):
		return []string{"processKey", "readinessUrl", "pid"}
	case (component == ComponentOpenCodeServer || component == ComponentCodexAppServer) && event == LifecycleEventComponentExited:
		return []string{"processKey", "pid"}
	case component == ComponentOpenCodeProxyConnectivity && lifecycleEventIn(event,
		LifecycleEventComponentStarting,
		LifecycleEventComponentStarted,
		LifecycleEventComponentHealthcheckFailed,
		LifecycleEventComponentRestartScheduled,
		LifecycleEventComponentRestartSucceeded,
	):
		return []string{"proxyUrl", "healthPath", "expectedStatus", "observedStatus", "connectivityState"}
	case component == ComponentOpenCodeProxyConnectivity && event == LifecycleEventComponentExited:
		return []string{"proxyUrl", "healthPath"}
	case component == ComponentPiProxy && lifecycleEventIn(event,
		LifecycleEventComponentStarting,
		LifecycleEventComponentStarted,
		LifecycleEventComponentHealthcheckFailed,
		LifecycleEventComponentExited,
		LifecycleEventComponentRestartScheduled,
		LifecycleEventComponentRestartSucceeded,
	):
		return []string{"listenAddr"}
	case component == ComponentPiRpcProcess && lifecycleEventIn(event,
		LifecycleEventComponentStarting,
		LifecycleEventComponentRestartScheduled,
		LifecycleEventComponentExited,
	):
		return []string{"cliPath"}
	case component == ComponentPiRpcProcess && lifecycleEventIn(event,
		LifecycleEventComponentStarted,
		LifecycleEventComponentRestartSucceeded,
		LifecycleEventComponentHealthcheckFailed,
	):
		return []string{"cliPath", "pid"}
	case component == ComponentPiProxyConnectivity && lifecycleEventIn(event,
		LifecycleEventComponentStarting,
		LifecycleEventComponentStarted,
		LifecycleEventComponentHealthcheckFailed,
		LifecycleEventComponentRestartScheduled,
		LifecycleEventComponentRestartSucceeded,
	):
		return []string{"proxyUrl", "requestMethod", "connectivityState"}
	case component == ComponentPiProxyConnectivity && event == LifecycleEventComponentExited:
		return []string{"proxyUrl", "requestMethod"}
	case component == ComponentRuntimeAgentEndpoint && lifecycleEventIn(event,
		LifecycleEventComponentStarting,
		LifecycleEventComponentStarted,
		LifecycleEventComponentHealthcheckFailed,
		LifecycleEventComponentRestartScheduled,
		LifecycleEventComponentRestartSucceeded,
	):
		return []string{"endpointUrl", "connectivityState"}
	case component == ComponentRuntimeAgentEndpoint && event == LifecycleEventComponentExited:
		return []string{"endpointUrl"}
	default:
		return nil
	}
}

func lifecycleEventIn(event LifecycleEventName, candidates ...LifecycleEventName) bool {
	return slices.Contains(candidates, event)
}
