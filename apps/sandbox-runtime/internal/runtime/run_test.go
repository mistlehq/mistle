package runtime

import (
	"bytes"
	"strings"
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

func TestRun(t *testing.T) {
	t.Run("fails when lookup env function is missing", func(t *testing.T) {
		err := Run(RunInput{
			Stdin: bytes.NewBufferString("test-token"),
		})
		if err == nil {
			t.Fatal("expected error when lookup env function is missing")
		}
	})

	t.Run("fails when stdin reader is missing", func(t *testing.T) {
		err := Run(RunInput{
			LookupEnv: func(string) (string, bool) {
				return ":8090", true
			},
		})
		if err == nil {
			t.Fatal("expected error when stdin reader is missing")
		}
	})

	t.Run("fails when runtime plan apply fails", func(t *testing.T) {
		startupInputJSON := `{"bootstrapToken":"test-token","tunnelExchangeToken":"test-exchange-token","tunnelGatewayWsUrl":"ws://127.0.0.1:5003/tunnel/sandbox","runtimePlan":{"sandboxProfileId":"sbp_test","version":1,"image":{"source":"base","imageRef":"mistle/sandbox-base:dev"},"egressRoutes":[],"artifacts":[],"runtimeClients":[{"clientId":"client_test","setup":{"env":{},"files":[{"fileId":"file_test","path":"/tmp","mode":420,"content":"invalid-target"}]},"processes":[],"endpoints":[]}],"workspaceSources":[],"agentRuntimes":[]}}`

		err := Run(RunInput{
			LookupEnv: func(key string) (string, bool) {
				switch key {
				case config.ListenAddrEnv:
					return ":0", true
				case config.TokenizerProxyEgressBaseURLEnv:
					return "http://127.0.0.1:5004/tokenizer-proxy/egress", true
				default:
					return "", false
				}
			},
			Stdin: bytes.NewBufferString(startupInputJSON),
		})
		if err == nil {
			t.Fatal("expected error when runtime plan apply fails")
		}
		if !strings.Contains(err.Error(), "failed to apply runtime plan") {
			t.Fatalf("expected runtime plan apply failure, got %v", err)
		}
	})

	t.Run("fails when runtime client process startup fails", func(t *testing.T) {
		startupInputJSON := `{"bootstrapToken":"test-token","tunnelExchangeToken":"test-exchange-token","tunnelGatewayWsUrl":"ws://127.0.0.1:5003/tunnel/sandbox","runtimePlan":{"sandboxProfileId":"sbp_test","version":1,"image":{"source":"base","imageRef":"mistle/sandbox-base:dev"},"egressRoutes":[],"artifacts":[],"runtimeClients":[{"clientId":"client_codex","setup":{"env":{},"files":[]},"processes":[{"processKey":"process_codex_server","command":{"args":["/definitely/missing/binary"],"env":{},"cwd":"","timeoutMs":0},"readiness":{"type":"none","host":"","port":0,"timeoutMs":0,"url":"","expectedStatus":0},"stop":{"signal":"sigterm","timeoutMs":1000,"gracePeriodMs":100}}],"endpoints":[]}],"workspaceSources":[],"agentRuntimes":[]}}`

		err := Run(RunInput{
			LookupEnv: func(key string) (string, bool) {
				switch key {
				case config.ListenAddrEnv:
					return ":0", true
				case config.TokenizerProxyEgressBaseURLEnv:
					return "http://127.0.0.1:5004/tokenizer-proxy/egress", true
				default:
					return "", false
				}
			},
			Stdin: bytes.NewBufferString(startupInputJSON),
		})
		if err == nil {
			t.Fatal("expected error when runtime client process startup fails")
		}
		if !strings.Contains(err.Error(), "failed to start runtime client processes") {
			t.Fatalf("expected runtime client process startup failure, got %v", err)
		}
	})
}

func TestFlattenRuntimeClientProcesses(t *testing.T) {
	t.Run("merges runtime client setup env into process command env", func(t *testing.T) {
		runtimeClients := []startup.RuntimeClient{
			{
				ClientID: "codex-cli",
				Setup: startup.RuntimeClientSetup{
					Env: map[string]string{
						"OPENAI_BASE_URL": "https://api.openai.com/v1",
						"OPENAI_MODEL":    "gpt-5.3-codex",
						"CONFLICT_KEY":    "setup-value",
					},
					Files: []startup.RuntimeFileSpec{},
				},
				Processes: []startup.RuntimeClientProcessSpec{
					{
						ProcessKey: "codex-app-server",
						Command: startup.RuntimeArtifactCommand{
							Args: []string{"/usr/local/bin/codex", "app-server"},
							Env: map[string]string{
								"PROCESS_ONLY": "enabled",
								"CONFLICT_KEY": "process-value",
							},
						},
					},
				},
				Endpoints: []startup.RuntimeClientEndpointSpec{},
			},
		}

		flattened := flattenRuntimeClientProcesses(runtimeClients)
		if len(flattened) != 1 {
			t.Fatalf("expected 1 flattened process, got %d", len(flattened))
		}

		expectedEnv := map[string]string{
			"OPENAI_BASE_URL": "https://api.openai.com/v1",
			"OPENAI_MODEL":    "gpt-5.3-codex",
			"PROCESS_ONLY":    "enabled",
			"CONFLICT_KEY":    "process-value",
		}
		if !mapsEqual(flattened[0].Command.Env, expectedEnv) {
			t.Fatalf("unexpected merged env: %#v", flattened[0].Command.Env)
		}
	})

	t.Run("uses nil env when setup and process env are both empty", func(t *testing.T) {
		runtimeClients := []startup.RuntimeClient{
			{
				ClientID: "client-empty-env",
				Setup: startup.RuntimeClientSetup{
					Env:   map[string]string{},
					Files: []startup.RuntimeFileSpec{},
				},
				Processes: []startup.RuntimeClientProcessSpec{
					{
						ProcessKey: "process-no-env",
						Command: startup.RuntimeArtifactCommand{
							Args: []string{"/bin/true"},
							Env:  map[string]string{},
						},
					},
				},
				Endpoints: []startup.RuntimeClientEndpointSpec{},
			},
		}

		flattened := flattenRuntimeClientProcesses(runtimeClients)
		if len(flattened) != 1 {
			t.Fatalf("expected 1 flattened process, got %d", len(flattened))
		}

		if flattened[0].Command.Env != nil {
			t.Fatalf("expected nil env for empty setup/process env, got %#v", flattened[0].Command.Env)
		}
	})
}

func mapsEqual(left map[string]string, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}

	for key, value := range left {
		if right[key] != value {
			return false
		}
	}

	return true
}
