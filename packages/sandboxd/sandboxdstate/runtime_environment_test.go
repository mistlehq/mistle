package sandboxdstate

import (
	"encoding/json"
	"maps"
	"testing"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime"
)

func TestCollectsRuntimeEnvironmentFromArtifacts(t *testing.T) {
	runtimePlan := runtime.CompiledRuntimePlan{
		SandboxProfileID: "sbp_runtime_env",
		Version:          1,
		Image:            testRuntimePlanImage(runtime.CompiledRuntimePlanImageBase),
		Artifacts: []runtime.CompiledRuntimeArtifact{
			{
				ArtifactKey: "gh-cli",
				Name:        "GitHub CLI",
				Env:         map[string]string{"GH_TOKEN": "token-value"},
			},
			{
				ArtifactKey: "jira-cli",
				Name:        "Jira CLI",
				Env:         map[string]string{"JIRA_BASE_URL": "https://mistle.atlassian.net"},
			},
		},
	}

	runtimeEnv, err := CollectRuntimeEnvironment(runtimePlan)
	requireNoError(t, err)

	assertStringMapsEqual(t, runtimeEnv, map[string]string{
		"GH_TOKEN":      "token-value",
		"JIRA_BASE_URL": "https://mistle.atlassian.net",
	})
}

func TestRejectsConflictingRuntimeEnvironmentValues(t *testing.T) {
	runtimePlan := runtime.CompiledRuntimePlan{
		SandboxProfileID: "sbp_runtime_env",
		Version:          1,
		Image:            testRuntimePlanImage(runtime.CompiledRuntimePlanImageBase),
		Artifacts: []runtime.CompiledRuntimeArtifact{
			{ArtifactKey: "artifact-a", Name: "Artifact A", Env: map[string]string{"GH_TOKEN": "first"}},
			{ArtifactKey: "artifact-b", Name: "Artifact B", Env: map[string]string{"GH_TOKEN": "second"}},
		},
	}

	_, err := CollectRuntimeEnvironment(runtimePlan)
	if err == nil {
		t.Fatalf("expected conflicting env values to fail")
	}
	assertEqual(t, err.Error(), "runtime plan artifacts define conflicting values for env \"GH_TOKEN\"")
}

func TestAddsDefaultGlobalGitConfigToManagedRuntimeEnvironment(t *testing.T) {
	runtimeEnv, err := MergeManagedRuntimeEnvironment(map[string]string{}, mistleContextEnv(), nil)
	requireNoError(t, err)

	assertStringMapsEqual(t, runtimeEnv, map[string]string{
		GlobalGitConfigEnvName:             DefaultGlobalGitConfigPath,
		MistleSandboxInstanceIDEnvName:     "sbi_test_001",
		MistleSandboxProfileIDEnvName:      "sbp_test_001",
		MistleSandboxProfileVersionEnvName: "7",
	})
}

func TestAllowsRuntimePlanToDefinePath(t *testing.T) {
	runtimeEnv, err := MergeManagedRuntimeEnvironment(
		map[string]string{"PATH": "/usr/local/bin:/usr/bin:/bin"},
		mistleContextEnv(),
		nil,
	)
	requireNoError(t, err)

	assertEqual(t, runtimeEnv["PATH"], "/usr/local/bin:/usr/bin:/bin")
	assertEqual(t, runtimeEnv[GlobalGitConfigEnvName], DefaultGlobalGitConfigPath)
}

func TestRejectsRuntimePlanGlobalGitConfigOverride(t *testing.T) {
	_, err := MergeManagedRuntimeEnvironment(
		map[string]string{GlobalGitConfigEnvName: "/tmp/not-sandboxd-owned"},
		mistleContextEnv(),
		nil,
	)
	if err == nil {
		t.Fatalf("expected managed global git config override to fail")
	}
	assertEqual(t, err.Error(), "runtime plan artifacts define managed env \"GIT_CONFIG_GLOBAL\", which sandboxd reserves")
}

func TestExtractsMistleContextRuntimeEnvironmentFromSessionInput(t *testing.T) {
	sessionInput := buildSessionRuntimeInput(t, "ws://gateway.example.test/sbi_context_env_001", minimalRuntimePlanJSON(t))

	runtimeEnv, err := CollectMistleContextRuntimeEnvironment(sessionInput, "sbi_context_env_001")
	requireNoError(t, err)

	assertStringMapsEqual(t, runtimeEnv, map[string]string{
		MistleSandboxInstanceIDEnvName:     "sbi_context_env_001",
		MistleSandboxProfileIDEnvName:      "sbp_test_001",
		MistleSandboxProfileVersionEnvName: "1",
	})
}

func TestMistleContextRuntimeEnvironmentRequiresSandboxProfileID(t *testing.T) {
	sessionInput := buildSessionRuntimeInput(t, "ws://gateway.example.test/sbi_context_env_001", []byte(`{"version":1}`))

	_, err := CollectMistleContextRuntimeEnvironment(sessionInput, "sbi_context_env_001")
	if err == nil {
		t.Fatalf("expected missing sandboxProfileId to fail")
	}
	assertEqual(t, err.Error(), "runtime plan sandboxProfileId is required for managed env")
}

func TestMistleContextRuntimeEnvironmentRequiresVersion(t *testing.T) {
	sessionInput := buildSessionRuntimeInput(t, "ws://gateway.example.test/sbi_context_env_001", []byte(`{"sandboxProfileId":"sbp_test_001"}`))

	_, err := CollectMistleContextRuntimeEnvironment(sessionInput, "sbi_context_env_001")
	if err == nil {
		t.Fatalf("expected missing version to fail")
	}
	assertEqual(t, err.Error(), "runtime plan version is required for managed env")
}

func testRuntimePlanImage(source runtime.CompiledRuntimePlanImageSource) runtime.CompiledRuntimePlanImage {
	return runtime.CompiledRuntimePlanImage{
		Source:   source,
		ImageRef: "registry.example.test/base:latest",
	}
}

func mistleContextEnv() map[string]string {
	return map[string]string{
		MistleSandboxInstanceIDEnvName:     "sbi_test_001",
		MistleSandboxProfileIDEnvName:      "sbp_test_001",
		MistleSandboxProfileVersionEnvName: "7",
	}
}

func buildSessionRuntimeInput(t *testing.T, tunnelGatewayWSURL string, runtimePlan json.RawMessage) protocol.SessionRuntimeInput {
	t.Helper()
	return protocol.SessionRuntimeInput{
		OperationKind:       protocol.ActivationOperationStart,
		BootstrapToken:      "bootstrap-token-value",
		TunnelExchangeToken: "tunnel-exchange-token-value",
		TunnelGatewayWSURL:  tunnelGatewayWSURL,
		RuntimePlan:         runtimePlan,
	}
}

func minimalRuntimePlanJSON(t *testing.T) []byte {
	t.Helper()
	return []byte(`{
		"sandboxProfileId": "sbp_test_001",
		"version": 1,
		"image": {
			"source": "base",
			"imageRef": "registry.example.test/base:latest"
		},
		"egressRoutes": [],
		"artifacts": [],
		"runtimeClients": []
	}`)
}

func assertStringMapsEqual(t *testing.T, actual map[string]string, expected map[string]string) {
	t.Helper()
	if !maps.Equal(actual, expected) {
		t.Fatalf("expected %#v, got %#v", expected, actual)
	}
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
