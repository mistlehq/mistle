package sandboxdstate

import (
	"encoding/json"
	"testing"

	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/runtime/readiness"
	"github.com/mistle/sandboxd/supervision"
)

func TestCollectTrackedComponentsAlwaysTracksDaemonAndTunnel(t *testing.T) {
	components := CollectTrackedComponents(runtimePlanWithAgentRuntimes(nil))

	assertComponents(t, components,
		supervision.ComponentSandboxd,
		supervision.ComponentTunnelSession,
	)
	assertEqual(t, DetermineRuntimeReadinessMode(components), readiness.ModeNoAgentRuntime)
}

func TestCollectTrackedComponentsIncludesEgressProxyWhenRoutesExist(t *testing.T) {
	runtimePlan := runtimePlanWithAgentRuntimes(nil)
	runtimePlan.EgressRoutes = []any{map[string]any{"egressRuleId": "egress_rule_123"}}

	components := CollectTrackedComponents(runtimePlan)

	assertComponents(t, components,
		supervision.ComponentSandboxd,
		supervision.ComponentTunnelSession,
		supervision.ComponentEgressProxy,
	)
}

func TestCollectTrackedComponentsForCodexRuntime(t *testing.T) {
	components := CollectTrackedComponents(runtimePlanWithAgentRuntimes([]string{"codex"}))

	assertComponents(t, components,
		supervision.ComponentSandboxd,
		supervision.ComponentTunnelSession,
		supervision.ComponentCodexProxy,
		supervision.ComponentCodexAppServer,
		supervision.ComponentRuntimeAgentEndpoint,
	)
	assertEqual(t, DetermineRuntimeReadinessMode(components), readiness.ModeCodex)
}

func TestCollectTrackedComponentsForOpenCodeRuntime(t *testing.T) {
	components := CollectTrackedComponents(runtimePlanWithAgentRuntimes([]string{"opencode"}))

	assertComponents(t, components,
		supervision.ComponentSandboxd,
		supervision.ComponentTunnelSession,
		supervision.ComponentOpenCodeProxy,
		supervision.ComponentOpenCodeServer,
		supervision.ComponentOpenCodeProxyConnectivity,
		supervision.ComponentRuntimeAgentEndpoint,
	)
	assertEqual(t, DetermineRuntimeReadinessMode(components), readiness.ModeOpenCode)
}

func TestCollectTrackedComponentsForPiRuntime(t *testing.T) {
	components := CollectTrackedComponents(runtimePlanWithAgentRuntimes([]string{"pi"}))

	assertComponents(t, components,
		supervision.ComponentSandboxd,
		supervision.ComponentTunnelSession,
		supervision.ComponentPiProxy,
		supervision.ComponentPiRpcProcess,
		supervision.ComponentPiProxyConnectivity,
		supervision.ComponentRuntimeAgentEndpoint,
	)
	assertEqual(t, DetermineRuntimeReadinessMode(components), readiness.ModePi)
}

func TestDetermineRuntimeReadinessModeSupportsProxyOnlyModes(t *testing.T) {
	assertEqual(t, DetermineRuntimeReadinessMode([]supervision.SupervisedComponent{
		supervision.ComponentCodexProxy,
	}), readiness.ModeCodexProxyOnly)
	assertEqual(t, DetermineRuntimeReadinessMode([]supervision.SupervisedComponent{
		supervision.ComponentOpenCodeProxy,
	}), readiness.ModeOpenCodeProxyOnly)
	assertEqual(t, DetermineRuntimeReadinessMode([]supervision.SupervisedComponent{
		supervision.ComponentPiProxy,
	}), readiness.ModePiProxyOnly)
}

func runtimePlanWithAgentRuntimes(runtimeIDs []string) runtime.CompiledRuntimePlan {
	agentRuntimes := make([]runtime.CompiledAgentRuntime, 0, len(runtimeIDs))
	for _, runtimeID := range runtimeIDs {
		agentRuntimes = append(agentRuntimes, runtime.CompiledAgentRuntime{
			RuntimeID:   runtimeID,
			RuntimeKey:  runtimeID + "-runtime",
			ClientID:    runtimeID + "-client",
			EndpointKey: runtimeID + "-endpoint",
			PTYLaunch:   json.RawMessage(`{"runtimeId":"` + runtimeID + `"}`),
		})
	}

	return runtime.CompiledRuntimePlan{
		SandboxProfileID: "sbp_components",
		Version:          1,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   runtime.CompiledRuntimePlanImageBase,
			ImageRef: "registry.example.test/base:latest",
		},
		AgentRuntimes: agentRuntimes,
	}
}

func assertComponents(t *testing.T, actual []supervision.SupervisedComponent, expected ...supervision.SupervisedComponent) {
	t.Helper()
	assertEqual(t, len(actual), len(expected))
	for index, component := range expected {
		assertEqual(t, actual[index], component)
	}
}
