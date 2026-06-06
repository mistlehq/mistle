package runtime

import (
	"encoding/json"
	"testing"
)

func TestCompiledRuntimePlanDecodesAgentRuntimes(t *testing.T) {
	var runtimePlan CompiledRuntimePlan
	err := json.Unmarshal([]byte(`{
		"sandboxProfileId": "sbp_runtime_plan",
		"version": 1,
		"image": {
			"source": "base",
			"imageRef": "registry.example.test/base:latest"
		},
		"setupScript": null,
		"egressRoutes": [],
		"artifacts": [],
		"runtimeClients": [],
		"agentRuntimes": [
			{
				"runtimeId": "codex",
				"runtimeKey": "codex-runtime",
				"clientId": "codex-cli",
				"endpointKey": "agent",
				"ptyLaunch": {
					"runtimeId": "codex",
					"displayName": "Codex"
				}
			}
		]
	}`), &runtimePlan)
	if err != nil {
		t.Fatalf("expected runtime plan to decode, got %v", err)
	}

	assertEqual(t, len(runtimePlan.AgentRuntimes), 1)
	agentRuntime := runtimePlan.AgentRuntimes[0]
	assertEqual(t, agentRuntime.RuntimeID, "codex")
	assertEqual(t, agentRuntime.RuntimeKey, "codex-runtime")
	assertEqual(t, agentRuntime.ClientID, "codex-cli")
	assertEqual(t, agentRuntime.EndpointKey, "agent")
	assertEqual(t, string(agentRuntime.PTYLaunch), `{
					"runtimeId": "codex",
					"displayName": "Codex"
				}`)
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
