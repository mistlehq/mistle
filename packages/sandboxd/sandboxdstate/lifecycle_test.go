package sandboxdstate

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
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

func TestActivateNewStartConnectsBootstrapTunnel(t *testing.T) {
	requests := make(chan string, 1)
	gatewayURL, closeGateway := startLifecycleBootstrapGateway(t, requests)
	defer closeGateway()
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageBase)
	activationInput.TunnelGatewayWSURL = gatewayURL

	state, err := ActivateNew(activationInput, timeutil.NewMutableClock(1_700_000_000_000))

	requireNoError(t, err)
	defer state.Close()
	assertEqual(t, receiveLifecycleBootstrapRequest(t, requests), "bootstrap_token=bootstrap-token")
	tunnelSnapshot := state.HealthSnapshot().Components[1]
	assertEqual(t, tunnelSnapshot.Component, supervision.ComponentTunnelSession)
	assertEqual(t, tunnelSnapshot.State, supervision.ComponentHealthy)
}

func TestActivateNewAppliesRuntimeSetupFilesBeforeBootstrapTunnelConnect(t *testing.T) {
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageBase)
	targetPath := filepath.Join(t.TempDir(), "runtime/settings.json")
	activationInput.RuntimePlan = lifecycleRuntimePlanJSONWithFiles(runtime.CompiledRuntimePlanImageBase, targetPath)
	activationInput.TunnelGatewayWSURL = "ws://127.0.0.1:1/bootstrap/sbi_lifecycle"

	_, err := ActivateNew(activationInput, timeutil.NewMutableClock(1_700_000_000_000))

	if err == nil {
		t.Fatalf("expected bootstrap tunnel connection failure")
	}
	if !strings.Contains(err.Error(), "failed to start bootstrap tunnel session: failed to connect bootstrap tunnel:") {
		t.Fatalf("expected bootstrap tunnel connection error, got %q", err.Error())
	}
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

func startLifecycleBootstrapGateway(t *testing.T, requests chan<- string) (string, func()) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		requests <- request.URL.RawQuery
		_, _, _ = connection.Read(request.Context())
		_ = connection.Close(websocket.StatusNormalClosure, "")
	}))
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/bootstrap/sbi_lifecycle", server.Close
}

func receiveLifecycleBootstrapRequest(t *testing.T, requests <-chan string) string {
	t.Helper()
	select {
	case request := <-requests:
		return request
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for bootstrap gateway request")
		return ""
	}
}
