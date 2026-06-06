package sandboxdstate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestActivateNewSnapshotWithPrematerializedImageBuildsManagedState(t *testing.T) {
	state, err := ActivateNew(lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageSnapshot), timeutil.NewMutableClock(1_700_000_000_000))

	requireNoError(t, err)
	assertEqual(t, state.SandboxInstanceID(), "sbi_lifecycle")
	assertEqual(t, string(state.ExecutionMode()), "session")
	runtimeEnv := state.RuntimeEnvironment()
	assertEqual(t, runtimeEnv[MistleSandboxInstanceIDEnvName], "sbi_lifecycle")
	assertEqual(t, runtimeEnv[MistleSandboxProfileIDEnvName], "profile_lifecycle")
	assertEqual(t, runtimeEnv[MistleSandboxProfileVersionEnvName], "7")
	assertEqual(t, runtimeEnv[GlobalGitConfigEnvName], DefaultGlobalGitConfigPath)
	snapshot := state.HealthSnapshot()
	assertEqual(t, snapshot.Components[0].Component, supervision.ComponentSandboxd)
	assertEqual(t, snapshot.Components[0].State, supervision.ComponentStopped)
	assertEqual(t, snapshot.Components[1].Component, supervision.ComponentTunnelSession)
}

func TestActivateNewStartFailsAtBootstrapTunnelSessionBoundary(t *testing.T) {
	_, err := ActivateNew(lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageBase), timeutil.NewMutableClock(1_700_000_000_000))

	if err == nil {
		t.Fatalf("expected bootstrap tunnel session migration boundary")
	}
	assertEqual(t, err.Error(), "failed to start bootstrap tunnel session: bootstrap tunnel session is not migrated to Go")
}

func TestActivateNewAppliesRuntimeSetupFilesBeforeBootstrapTunnelSessionBoundary(t *testing.T) {
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageBase)
	targetPath := filepath.Join(t.TempDir(), "runtime/settings.json")
	activationInput.RuntimePlan = lifecycleRuntimePlanJSONWithFiles(runtime.CompiledRuntimePlanImageBase, targetPath)

	_, err := ActivateNew(activationInput, timeutil.NewMutableClock(1_700_000_000_000))

	if err == nil {
		t.Fatalf("expected bootstrap tunnel session migration boundary")
	}
	assertEqual(t, err.Error(), "failed to start bootstrap tunnel session: bootstrap tunnel session is not migrated to Go")
	assertEqual(t, readLifecycleFile(t, targetPath), "{\"ready\":true}\n")
}

func TestActivateNewRejectsInvalidRuntimePlanBeforeStateInitialization(t *testing.T) {
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageSnapshot)
	activationInput.RuntimePlan = []byte(`{"version":7}`)

	_, err := ActivateNew(activationInput, timeutil.NewMutableClock(1_700_000_000_000))

	if err == nil {
		t.Fatalf("expected invalid runtime plan to fail")
	}
	assertEqual(t, err.Error(), "failed to apply session input: runtime plan sandboxProfileId is required")
}

func lifecycleActivationInput(
	operationKind protocol.ActivationOperationKind,
	imageSource runtime.CompiledRuntimePlanImageSource,
) protocol.ActivationInput {
	return protocol.ActivationInput{
		OperationKind:       operationKind,
		BootstrapToken:      "bootstrap-token",
		TunnelExchangeToken: "exchange-token",
		TunnelGatewayWSURL:  "ws://gateway.example.test/bootstrap/sbi_lifecycle",
		RuntimePlan:         lifecycleRuntimePlanJSON(imageSource),
	}
}

func lifecycleRuntimePlanJSON(imageSource runtime.CompiledRuntimePlanImageSource) []byte {
	runtimePlan := runtime.CompiledRuntimePlan{
		SandboxProfileID: "profile_lifecycle",
		Version:          7,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   imageSource,
			ImageRef: "image-ref",
		},
	}
	payload, err := json.Marshal(runtimePlan)
	if err != nil {
		panic(err)
	}
	return payload
}

func lifecycleRuntimePlanJSONWithFiles(imageSource runtime.CompiledRuntimePlanImageSource, targetPath string) []byte {
	runtimePlan := runtime.CompiledRuntimePlan{
		SandboxProfileID: "profile_lifecycle",
		Version:          7,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   imageSource,
			ImageRef: "image-ref",
		},
		RuntimeClients: []runtime.RuntimeClient{
			{
				ClientID: "codex-cli",
				Setup: runtime.RuntimeClientSetup{
					Files: []runtime.RuntimeClientSetupFile{
						{
							FileID:  "settings",
							Path:    targetPath,
							Mode:    0o640,
							Content: "{\"ready\":true}\n",
						},
					},
				},
			},
		},
	}
	payload, err := json.Marshal(runtimePlan)
	if err != nil {
		panic(err)
	}
	return payload
}

func readLifecycleFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	requireNoError(t, err)
	return string(content)
}
