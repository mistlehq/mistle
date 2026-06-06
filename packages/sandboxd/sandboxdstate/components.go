package sandboxdstate

import (
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/runtime/readiness"
	"github.com/mistle/sandboxd/supervision"
)

func DetermineRuntimeReadinessMode(trackedComponents []supervision.SupervisedComponent) readiness.Mode {
	if tracksComponent(trackedComponents, supervision.ComponentCodexAppServer) {
		return readiness.ModeCodex
	}
	if tracksComponent(trackedComponents, supervision.ComponentCodexProxy) {
		return readiness.ModeCodexProxyOnly
	}
	if tracksComponent(trackedComponents, supervision.ComponentOpenCodeServer) {
		return readiness.ModeOpenCode
	}
	if tracksComponent(trackedComponents, supervision.ComponentOpenCodeProxy) {
		return readiness.ModeOpenCodeProxyOnly
	}
	if tracksComponent(trackedComponents, supervision.ComponentPiRpcProcess) {
		return readiness.ModePi
	}
	if tracksComponent(trackedComponents, supervision.ComponentPiProxy) {
		return readiness.ModePiProxyOnly
	}
	return readiness.ModeNoAgentRuntime
}

func CollectTrackedComponents(runtimePlan runtime.CompiledRuntimePlan) []supervision.SupervisedComponent {
	tracked := map[supervision.SupervisedComponent]bool{
		supervision.ComponentSandboxd:      true,
		supervision.ComponentTunnelSession: true,
	}

	if len(runtimePlan.EgressRoutes) > 0 {
		tracked[supervision.ComponentEgressProxy] = true
	}

	if hasAgentRuntime(runtimePlan, "codex") {
		tracked[supervision.ComponentCodexProxy] = true
		tracked[supervision.ComponentCodexAppServer] = true
		tracked[supervision.ComponentRuntimeAgentEndpoint] = true
	}

	if hasAgentRuntime(runtimePlan, "opencode") {
		tracked[supervision.ComponentOpenCodeProxy] = true
		tracked[supervision.ComponentOpenCodeServer] = true
		tracked[supervision.ComponentOpenCodeProxyConnectivity] = true
		tracked[supervision.ComponentRuntimeAgentEndpoint] = true
	}

	if hasAgentRuntime(runtimePlan, "pi") {
		tracked[supervision.ComponentPiProxy] = true
		tracked[supervision.ComponentPiRpcProcess] = true
		tracked[supervision.ComponentPiProxyConnectivity] = true
		tracked[supervision.ComponentRuntimeAgentEndpoint] = true
	}

	components := make([]supervision.SupervisedComponent, 0, len(tracked))
	for _, component := range supervisedComponentOrder {
		if tracked[component] {
			components = append(components, component)
		}
	}
	return components
}

var supervisedComponentOrder = []supervision.SupervisedComponent{
	supervision.ComponentSandboxd,
	supervision.ComponentTunnelSession,
	supervision.ComponentEgressProxy,
	supervision.ComponentCodexProxy,
	supervision.ComponentCodexAppServer,
	supervision.ComponentOpenCodeProxy,
	supervision.ComponentOpenCodeServer,
	supervision.ComponentOpenCodeProxyConnectivity,
	supervision.ComponentPiProxy,
	supervision.ComponentPiRpcProcess,
	supervision.ComponentPiProxyConnectivity,
	supervision.ComponentRuntimeAgentEndpoint,
}

func hasAgentRuntime(runtimePlan runtime.CompiledRuntimePlan, runtimeID string) bool {
	for _, agentRuntime := range runtimePlan.AgentRuntimes {
		if agentRuntime.RuntimeID == runtimeID {
			return true
		}
	}
	return false
}

func tracksComponent(trackedComponents []supervision.SupervisedComponent, component supervision.SupervisedComponent) bool {
	for _, trackedComponent := range trackedComponents {
		if trackedComponent == component {
			return true
		}
	}
	return false
}
