package readiness

import (
	"github.com/mistle/sandboxd/supervision"
)

type Mode string

const (
	ModeNoAgentRuntime    Mode = "NoAgentRuntime"
	ModeCodexProxyOnly    Mode = "CodexProxyOnly"
	ModeCodex             Mode = "Codex"
	ModeOpenCode          Mode = "OpenCode"
	ModeOpenCodeProxyOnly Mode = "OpenCodeProxyOnly"
	ModePi                Mode = "Pi"
	ModePiProxyOnly       Mode = "PiProxyOnly"
)

func DeriveRuntimeReady(snapshot supervision.HealthSnapshot, mode Mode) bool {
	switch mode {
	case ModeNoAgentRuntime:
		return true
	case ModeCodexProxyOnly:
		return codexProxyIsReady(snapshot) && runtimeAgentEndpointIsReady(snapshot)
	case ModeCodex:
		return codexProxyIsReady(snapshot) &&
			componentIsHealthy(snapshot, supervision.ComponentCodexAppServer) &&
			runtimeAgentEndpointIsReady(snapshot)
	case ModeOpenCodeProxyOnly:
		return componentIsHealthy(snapshot, supervision.ComponentOpenCodeProxy) &&
			componentIsReadyWhenTracked(snapshot, supervision.ComponentOpenCodeProxyConnectivity) &&
			runtimeAgentEndpointIsReady(snapshot)
	case ModeOpenCode:
		return componentIsHealthy(snapshot, supervision.ComponentOpenCodeProxy) &&
			componentIsHealthy(snapshot, supervision.ComponentOpenCodeServer) &&
			componentIsReadyWhenTracked(snapshot, supervision.ComponentOpenCodeProxyConnectivity) &&
			runtimeAgentEndpointIsReady(snapshot)
	case ModePi:
		return componentIsHealthy(snapshot, supervision.ComponentPiProxy) &&
			componentIsHealthy(snapshot, supervision.ComponentPiRpcProcess) &&
			componentIsReadyWhenTracked(snapshot, supervision.ComponentPiProxyConnectivity) &&
			runtimeAgentEndpointIsReady(snapshot)
	case ModePiProxyOnly:
		return componentIsHealthy(snapshot, supervision.ComponentPiProxy) &&
			componentIsReadyWhenTracked(snapshot, supervision.ComponentPiProxyConnectivity) &&
			runtimeAgentEndpointIsReady(snapshot)
	default:
		return false
	}
}

type ReadyState struct {
	MessageType ReadyMessageType `json:"type"`
	Ready       bool             `json:"ready"`
}

type ReadyMessageType string

const ReadyMessageState ReadyMessageType = "runtime.ready"

type Manager struct {
	ready              bool
	tunnelConnected    bool
	lastPublishedReady *bool
}

func (manager *Manager) OnTunnelConnected() {
	manager.tunnelConnected = true
	manager.lastPublishedReady = nil
}

func (manager *Manager) OnTunnelDisconnected() {
	manager.tunnelConnected = false
}

func (manager *Manager) SetReady(ready bool) {
	manager.ready = ready
}

func (manager *Manager) Ready() bool {
	return manager.ready
}

func (manager *Manager) TakeInitialPublishableState() *ReadyState {
	if !manager.tunnelConnected {
		return nil
	}
	ready := manager.ready
	manager.lastPublishedReady = &ready
	return &ReadyState{MessageType: ReadyMessageState, Ready: manager.ready}
}

func (manager *Manager) TakePublishableState() *ReadyState {
	if !manager.tunnelConnected || (manager.lastPublishedReady != nil && *manager.lastPublishedReady == manager.ready) {
		return nil
	}
	ready := manager.ready
	manager.lastPublishedReady = &ready
	return &ReadyState{MessageType: ReadyMessageState, Ready: manager.ready}
}

func componentIsHealthy(snapshot supervision.HealthSnapshot, component supervision.SupervisedComponent) bool {
	for _, candidate := range snapshot.Components {
		if candidate.Component == component {
			return candidate.State == supervision.ComponentHealthy
		}
	}
	return false
}

func componentIsReadyWhenTracked(snapshot supervision.HealthSnapshot, component supervision.SupervisedComponent) bool {
	for _, candidate := range snapshot.Components {
		if candidate.Component == component {
			return candidate.State == supervision.ComponentHealthy
		}
	}
	return true
}

func codexProxyIsReady(snapshot supervision.HealthSnapshot) bool {
	for _, candidate := range snapshot.Components {
		if candidate.Component != supervision.ComponentCodexProxy {
			continue
		}
		return candidate.State == supervision.ComponentHealthy &&
			candidate.Details["sessionManagerState"] == "Connected" &&
			candidate.Details["rawConnectivityState"] == "Connected"
	}
	return false
}

func runtimeAgentEndpointIsReady(snapshot supervision.HealthSnapshot) bool {
	return componentIsReadyWhenTracked(snapshot, supervision.ComponentRuntimeAgentEndpoint)
}
