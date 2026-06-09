package runtime

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCompiledRuntimePlanRejectsUnknownTopLevelFields(t *testing.T) {
	var runtimePlan CompiledRuntimePlan
	err := json.Unmarshal([]byte(`{
		"sandboxProfileId": "sbp_01k00000000000000000000000",
		"version": 1,
		"image": {
			"source": "base",
			"imageRef": "registry.example.test/base:latest"
		},
		"egressRoutes": [],
		"artifacts": [],
		"workspaceSources": [],
		"runtimeClients": [],
		"agentRuntimes": [],
		"futureRuntimePlanField": true
	}`), &runtimePlan)
	if err == nil {
		t.Fatalf("expected runtime plan decoder to reject unknown top-level fields")
	}
	if !strings.Contains(err.Error(), "futureRuntimePlanField") {
		t.Fatalf("expected unknown field error to name futureRuntimePlanField, got %v", err)
	}
}

func TestCompiledRuntimePlanRejectsUnsupportedNestedEnumAndUnionValues(t *testing.T) {
	tests := []struct {
		name          string
		replace       string
		with          string
		mutate        func(t *testing.T, value map[string]any)
		errorContains string
	}{
		{
			name:          "unsupported image source",
			replace:       `"source": "base"`,
			with:          `"source": "future_image"`,
			errorContains: "unsupported runtime plan image source",
		},
		{
			name:          "unsupported artifact op",
			replace:       `"op": "exec"`,
			with:          `"op": "future_install"`,
			errorContains: "unsupported artifact install op",
		},
		{
			name:          "exec includes github field",
			replace:       `"command": {"args": ["true"]}`,
			with:          `"command": {"args": ["true"]}, "repository": "acme/tool"`,
			errorContains: "exec artifact install steps must not include fields",
		},
		{
			name:          "mise install missing tools",
			replace:       `"op": "exec"`,
			with:          `"op": "mise_install"`,
			errorContains: "mise_install artifact install steps must include at least one tool",
		},
		{
			name:          "unsupported workspace source kind",
			replace:       `"sourceKind": "git-clone"`,
			with:          `"sourceKind": "archive"`,
			errorContains: "unsupported workspace source kind",
		},
		{
			name:          "unsupported write mode",
			replace:       `"writeMode": "overwrite"`,
			with:          `"writeMode": "append"`,
			errorContains: "unsupported runtime file write mode",
		},
		{
			name:          "unsupported readiness type",
			replace:       `"type": "http"`,
			with:          `"type": "grpc"`,
			errorContains: "unsupported runtime process readiness type",
		},
		{
			name:          "unsupported stop signal",
			replace:       `"signal": "sigterm"`,
			with:          `"signal": "SIGINT"`,
			errorContains: "unsupported runtime process stop signal",
		},
		{
			name:          "unsupported endpoint transport",
			replace:       `"type": "ws"`,
			with:          `"type": "http"`,
			errorContains: "unsupported runtime client endpoint transport type",
		},
		{
			name:          "unsupported endpoint connection mode",
			replace:       `"connectionMode": "dedicated"`,
			with:          `"connectionMode": "raw"`,
			errorContains: "unsupported runtime client endpoint connection mode",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload := strings.Replace(runtimePlanValidationFixture(), test.replace, test.with, 1)
			var runtimePlan CompiledRuntimePlan
			err := json.Unmarshal([]byte(payload), &runtimePlan)
			if err == nil {
				t.Fatalf("expected runtime plan decode to fail")
			}
			if !strings.Contains(err.Error(), test.errorContains) {
				t.Fatalf("expected error containing %q, got %v", test.errorContains, err)
			}
		})
	}
}

func TestCompiledRuntimePlanAcceptsRustSharedEndpointConnectionMode(t *testing.T) {
	runtimePlan := decodePlanForRuntimePlanTest(t, strings.Replace(runtimePlanValidationFixture(), `"connectionMode": "dedicated"`, `"connectionMode": "shared"`, 1))
	assertEqual(t, runtimePlan.RuntimeClients[0].Endpoints[0].ConnectionMode, "shared")
}

func TestCompiledRuntimePlanAcceptsRustIgnoredExtraFieldsInSelectedNestedVariants(t *testing.T) {
	runtimePlan := decodePlanForRuntimePlanTest(t, mutateRuntimePlanValidationFixture(t, func(t *testing.T, value map[string]any) {
		t.Helper()
		runtimeClient := value["runtimeClients"].([]any)[0].(map[string]any)
		process := runtimeClient["processes"].([]any)[0].(map[string]any)
		process["readiness"].(map[string]any)["futureReadinessField"] = true
		runtimeClient["endpoints"].([]any)[0].(map[string]any)["transport"].(map[string]any)["futureTransportField"] = true
		value["workspaceSources"].([]any)[0].(map[string]any)["futureWorkspaceField"] = true
	}))

	assertEqual(t, runtimePlan.RuntimeClients[0].Processes[0].Readiness.TimeoutMS, uint64(1000))
	assertEqual(t, runtimePlan.RuntimeClients[0].Endpoints[0].Transport.URL, "ws://127.0.0.1:3000/agent")
	assertEqual(t, runtimePlan.WorkspaceSources[0].Path, "/workspace")
}

func TestCompiledRuntimePlanRejectsMissingRustRequiredNestedFields(t *testing.T) {
	tests := []struct {
		name          string
		replace       string
		with          string
		mutate        func(t *testing.T, value map[string]any)
		errorContains string
	}{
		{
			name:          "missing image source",
			replace:       `"source": "base",`,
			with:          ``,
			errorContains: "runtime plan image source field is required",
		},
		{
			name:          "missing exec args",
			replace:       `"command": {"args": ["true"]}`,
			with:          `"command": {}`,
			errorContains: "runtime exec command args field is required",
		},
		{
			name:          "missing process readiness type",
			replace:       `"type": "http",`,
			with:          ``,
			errorContains: "runtime process readiness type field is required",
		},
		{
			name:          "missing http process readiness timeout",
			mutate:        deleteRuntimePlanValidationFixtureHTTPReadinessField("timeoutMs"),
			errorContains: "http runtime process readiness timeoutMs field is required",
		},
		{
			name:          "missing process stop signal",
			replace:       `"signal": "sigterm",`,
			with:          ``,
			errorContains: "runtime process stop signal field is required",
		},
		{
			name:          "missing process stop timeout",
			mutate:        deleteRuntimePlanValidationFixtureStopField("timeoutMs"),
			errorContains: "runtime process stop timeoutMs field is required",
		},
		{
			name:          "missing endpoint transport type",
			replace:       `"type": "ws",`,
			with:          ``,
			errorContains: "runtime client endpoint transport type field is required",
		},
		{
			name:          "missing endpoint transport url",
			mutate:        deleteRuntimePlanValidationFixtureEndpointTransportField("url"),
			errorContains: "ws runtime client endpoint transport url field is required",
		},
		{
			name:          "missing endpoint connection mode",
			replace:       `},` + "\n" + `						"connectionMode": "dedicated"`,
			with:          `}`,
			errorContains: "runtime client endpoint connectionMode field is required",
		},
		{
			name:          "missing workspace path",
			replace:       `"path": "/workspace",`,
			with:          ``,
			errorContains: "workspace source path field is required",
		},
		{
			name:          "missing workspace origin url",
			mutate:        deleteRuntimePlanValidationFixtureWorkspaceSourceField("originUrl"),
			errorContains: "workspace source originUrl field is required",
		},
		{
			name:          "missing linked principal provider family",
			mutate:        deleteRuntimePlanValidationFixtureCredentialResolverField("providerFamily"),
			errorContains: "linked_principal egress credential resolver providerFamily field is required",
		},
		{
			name:          "missing auth injection type",
			mutate:        deleteRuntimePlanValidationFixtureAuthInjectionField("type"),
			errorContains: "egress auth injection type field is required",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload := strings.Replace(runtimePlanValidationFixture(), test.replace, test.with, 1)
			if test.mutate != nil {
				payload = mutateRuntimePlanValidationFixture(t, test.mutate)
			}
			var runtimePlan CompiledRuntimePlan
			err := json.Unmarshal([]byte(payload), &runtimePlan)
			if err == nil {
				t.Fatalf("expected runtime plan decode to fail")
			}
			if !strings.Contains(err.Error(), test.errorContains) {
				t.Fatalf("expected error containing %q, got %v", test.errorContains, err)
			}
		})
	}
}

func TestRuntimeClientProcessSerializesWithRustCompatibleFieldNames(t *testing.T) {
	payload, err := json.Marshal(RuntimeClientProcess{
		ProcessKey: "codex-app-server",
		Command: RuntimeExecCommand{
			Args: []string{"codex", "app-server"},
		},
		Readiness: RuntimeClientProcessReadiness{
			Type:      RuntimeClientProcessReadinessWS,
			URL:       "ws://127.0.0.1:8080",
			TimeoutMS: 1000,
		},
		Stop: RuntimeClientProcessStopPolicy{
			Signal:    RuntimeClientProcessStopSignalSIGTERM,
			TimeoutMS: 1000,
		},
	})
	requireNoError(t, err)

	var decoded map[string]any
	requireNoError(t, json.Unmarshal(payload, &decoded))
	if _, ok := decoded["ProcessKey"]; ok {
		t.Fatalf("expected Rust-compatible processKey field, got Go field names in %s", payload)
	}
	assertEqual(t, decoded["processKey"], "codex-app-server")
	readiness := decoded["readiness"].(map[string]any)
	assertEqual(t, readiness["timeoutMs"].(float64), float64(1000))
	stop := decoded["stop"].(map[string]any)
	assertEqual(t, stop["timeoutMs"].(float64), float64(1000))
}

func TestCompiledRuntimePlanDecodesRustCompatibleStopSignals(t *testing.T) {
	termPlan := decodePlanForRuntimePlanTest(t, runtimePlanValidationFixture())
	assertEqual(t, termPlan.RuntimeClients[0].Processes[0].Stop.Signal, RuntimeClientProcessStopSignalSIGTERM)
	killPlan := decodePlanForRuntimePlanTest(t, strings.Replace(runtimePlanValidationFixture(), `"signal": "sigterm"`, `"signal": "sigkill"`, 1))
	assertEqual(t, killPlan.RuntimeClients[0].Processes[0].Stop.Signal, RuntimeClientProcessStopSignalSIGKILL)
}

func TestCompiledRuntimePlanRejectsGoOnlyTimeoutAndStopSignalCasing(t *testing.T) {
	tests := []struct {
		name          string
		replace       string
		with          string
		mutate        func(t *testing.T, value map[string]any)
		errorContains string
	}{
		{
			name:          "readiness timeoutMS",
			mutate:        renameRuntimePlanValidationFixtureHTTPReadinessField("timeoutMs", "timeoutMS"),
			errorContains: "http runtime process readiness timeoutMs field is required",
		},
		{
			name:          "stop timeoutMS",
			mutate:        renameRuntimePlanValidationFixtureStopField("timeoutMs", "timeoutMS"),
			errorContains: "runtime process stop timeoutMs field is required",
		},
		{
			name:          "uppercase sigterm",
			replace:       `"signal": "sigterm"`,
			with:          `"signal": "SIGTERM"`,
			errorContains: "unsupported runtime process stop signal",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload := strings.Replace(runtimePlanValidationFixture(), test.replace, test.with, 1)
			if test.mutate != nil {
				payload = mutateRuntimePlanValidationFixture(t, test.mutate)
			}
			var runtimePlan CompiledRuntimePlan
			err := json.Unmarshal([]byte(payload), &runtimePlan)
			if err == nil {
				t.Fatalf("expected runtime plan decode to fail")
			}
			if !strings.Contains(err.Error(), test.errorContains) {
				t.Fatalf("expected error containing %q, got %v", test.errorContains, err)
			}
		})
	}
}

func TestCompiledRuntimePlanRejectsGitHubReleaseUnknownFieldsAndIncompleteByArchAssets(t *testing.T) {
	tests := []struct {
		name          string
		payload       string
		errorContains string
	}{
		{
			name: "release unknown field",
			payload: `{
				"kind": "tag",
				"match": "exact",
				"tag": "v1.2.3",
				"future": true
			}`,
			errorContains: "future",
		},
		{
			name: "asset shape unknown field",
			payload: `{
				"kind": "exact",
				"fileName": "tool",
				"format": "binary",
				"future": true
			}`,
			errorContains: "future",
		},
		{
			name: "asset missing kind",
			payload: `{
				"fileName": "tool",
				"format": "binary"
			}`,
			errorContains: "github release install asset kind is required",
		},
		{
			name: "by arch missing aarch64",
			payload: `{
				"kind": "by_arch",
				"x86_64": {
					"fileName": "tool-x86_64.tar.gz",
					"format": "tar.gz",
					"extractedPath": "tool"
				}
			}`,
			errorContains: "aarch64 github release asset is invalid",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if strings.Contains(test.name, "release") {
				var selector RuntimeArtifactGitHubReleaseSelector
				err := json.Unmarshal([]byte(test.payload), &selector)
				if err == nil {
					t.Fatalf("expected release selector decode to fail")
				}
				if !strings.Contains(err.Error(), test.errorContains) {
					t.Fatalf("expected error containing %q, got %v", test.errorContains, err)
				}
				return
			}
			var asset RuntimeArtifactGitHubReleaseInstallAsset
			err := json.Unmarshal([]byte(test.payload), &asset)
			if err == nil {
				t.Fatalf("expected release asset decode to fail")
			}
			if !strings.Contains(err.Error(), test.errorContains) {
				t.Fatalf("expected error containing %q, got %v", test.errorContains, err)
			}
		})
	}
}

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
		"workspaceSources": [],
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

func TestCompiledRuntimePlanDecodesGitHubReleaseInstallStepWithByArchAsset(t *testing.T) {
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
		"artifacts": [
			{
				"artifactKey": "codex-cli",
				"name": "Codex CLI",
				"env": {},
				"lifecycle": {
					"install": [
						{
							"op": "github_release_install",
							"repository": "openai/codex",
							"release": {
								"kind": "tag",
								"match": "exact",
								"tag": "rust-v0.137.0"
							},
							"asset": {
								"kind": "by_arch",
								"x86_64": {
									"fileName": "codex-x86_64-unknown-linux-musl.tar.gz",
									"format": "tar.gz",
									"extractedPath": "codex-x86_64-unknown-linux-musl/codex"
								},
								"aarch64": {
									"fileName": "codex-aarch64-unknown-linux-musl.tar.gz",
									"format": "tar.gz",
									"extractedPath": "codex-aarch64-unknown-linux-musl/codex"
								}
							},
							"installPath": "/usr/local/bin/codex",
							"timeoutMs": 120000
						}
					]
				}
			}
		],
		"workspaceSources": [],
		"runtimeClients": [],
		"agentRuntimes": []
	}`), &runtimePlan)
	if err != nil {
		t.Fatalf("expected runtime plan to decode, got %v", err)
	}

	installStep := runtimePlan.Artifacts[0].Lifecycle.Install[0]
	assertEqual(t, installStep.Op, RuntimeArtifactInstallOpGitHubReleaseInstall)
	assertEqual(t, installStep.Repository, "openai/codex")
	assertEqual(t, installStep.Release.Kind, RuntimeArtifactGitHubReleaseSelectorTag)
	assertEqual(t, installStep.Release.Match, RuntimeArtifactGitHubReleaseTagMatchExact)
	assertEqual(t, installStep.Release.Tag, "rust-v0.137.0")
	assertEqual(t, installStep.Asset.Kind, RuntimeArtifactGitHubReleaseInstallAssetKindByArch)
	assertEqual(t, installStep.Asset.X86_64.FileName, "codex-x86_64-unknown-linux-musl.tar.gz")
	assertEqual(t, installStep.Asset.X86_64.Format, RuntimeArtifactGitHubReleaseAssetFormatTarGz)
	assertEqual(t, installStep.Asset.X86_64.ExtractedPath, "codex-x86_64-unknown-linux-musl/codex")
	assertEqual(t, installStep.InstallPath, "/usr/local/bin/codex")
	if installStep.TimeoutMS == nil {
		t.Fatalf("expected timeoutMs to decode")
	}
	assertEqual(t, *installStep.TimeoutMS, uint64(120000))
}

func TestCompiledRuntimePlanDecodesGitHubReleaseExactAssetShape(t *testing.T) {
	runtimePlan := decodePlanForRuntimePlanTest(t, `{
		"sandboxProfileId": "sbp_runtime_plan",
		"version": 1,
		"image": {
			"source": "base",
			"imageRef": "registry.example.test/base:latest"
		},
		"setupScript": null,
		"egressRoutes": [],
		"artifacts": [
			{
				"artifactKey": "tool",
				"name": "Tool",
				"env": {},
				"lifecycle": {
					"install": [
						{
							"op": "github_release_install",
							"repository": "acme/tool",
							"release": {
								"kind": "tag",
								"match": "exact",
								"tag": "v1.2.3"
							},
							"asset": {
								"kind": "exact",
								"fileName": "tool-linux-amd64",
								"format": "binary",
								"sha256": "abc123"
							},
							"installPath": "/usr/local/bin/tool"
						}
					]
				}
			}
		],
		"workspaceSources": [],
		"runtimeClients": [],
		"agentRuntimes": []
	}`)

	installStep := runtimePlan.Artifacts[0].Lifecycle.Install[0]
	assertEqual(t, installStep.Asset.Kind, RuntimeArtifactGitHubReleaseInstallAssetKindExact)
	assertEqual(t, installStep.Asset.Exact.FileName, "tool-linux-amd64")
	assertEqual(t, installStep.Asset.Exact.Format, RuntimeArtifactGitHubReleaseAssetFormatBinary)
	if installStep.Asset.Exact.SHA256 == nil {
		t.Fatalf("expected exact asset sha256 to decode")
	}
	assertEqual(t, *installStep.Asset.Exact.SHA256, "abc123")
}

func TestCompiledRuntimePlanRejectsInvalidGitHubReleaseSelectorShapes(t *testing.T) {
	tests := []struct {
		name          string
		release       string
		errorContains string
	}{
		{
			name: "exact tag missing tag",
			release: `{
				"kind": "tag",
				"match": "exact"
			}`,
			errorContains: "tag must be present and non-empty",
		},
		{
			name: "exact tag includes prefix",
			release: `{
				"kind": "tag",
				"match": "exact",
				"tag": "v1.2.3",
				"prefix": "v"
			}`,
			errorContains: "exact github release selectors must not include prefix",
		},
		{
			name: "latest matching prefix includes tag",
			release: `{
				"kind": "tag",
				"match": "latest_matching_prefix",
				"tag": "v1.2.3",
				"prefix": "v"
			}`,
			errorContains: "latest_matching_prefix github release selectors must not include tag",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var selector RuntimeArtifactGitHubReleaseSelector
			err := json.Unmarshal([]byte(test.release), &selector)
			if err == nil {
				t.Fatalf("expected invalid selector shape to fail")
			}
			if !strings.Contains(err.Error(), test.errorContains) {
				t.Fatalf("expected error to contain %q, got %v", test.errorContains, err)
			}
		})
	}
}

func TestCompiledRuntimePlanRejectsInvalidGitHubReleaseAssetShapes(t *testing.T) {
	tests := []struct {
		name          string
		asset         string
		errorContains string
	}{
		{
			name: "binary includes extracted path",
			asset: `{
				"kind": "exact",
				"fileName": "tool-linux-amd64",
				"format": "binary",
				"extractedPath": "tool"
			}`,
			errorContains: "binary assets must not include extractedPath",
		},
		{
			name: "tarball missing extracted path",
			asset: `{
				"kind": "exact",
				"fileName": "tool-linux-amd64.tar.gz",
				"format": "tar.gz"
			}`,
			errorContains: "tar.gz assets must include extractedPath",
		},
		{
			name: "missing file name",
			asset: `{
				"kind": "exact",
				"format": "binary"
			}`,
			errorContains: "fileName must be present and non-empty",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var asset RuntimeArtifactGitHubReleaseInstallAsset
			err := json.Unmarshal([]byte(test.asset), &asset)
			if err == nil {
				t.Fatalf("expected invalid asset shape to fail")
			}
			if !strings.Contains(err.Error(), test.errorContains) {
				t.Fatalf("expected error to contain %q, got %v", test.errorContains, err)
			}
		})
	}
}

func TestCompiledRuntimePlanDecodesEgressRouteWithRequestMiddlewareAndCredentialHeaders(t *testing.T) {
	runtimePlan := decodePlanForRuntimePlanTest(t, `{
		"sandboxProfileId": "sbp_runtime_plan",
		"version": 1,
		"image": {
			"source": "base",
			"imageRef": "registry.example.test/base:latest"
		},
		"setupScript": null,
		"egressRoutes": [
			{
				"egressRuleId": "egress_rule_bind_github",
				"bindingId": "bind_github",
				"familyId": "github",
				"variantId": "github-default",
				"match": {
					"hosts": ["api.github.com"],
					"pathPrefixes": ["/repos"],
					"methods": ["POST"]
				},
				"upstream": {
					"baseUrl": "https://api.github.com"
				},
				"authInjection": {
					"type": "bearer",
					"target": "authorization"
				},
				"additionalHeaders": {
					"accept": "application/vnd.github+json"
				},
				"additionalCredentialHeaders": [
					{
						"header": "x-extra-token",
						"credentialResolver": {
							"kind": "integration_connection",
							"connectionId": "icn_extra",
							"secretType": "api_key",
							"slotKey": "extra"
						}
					}
				],
				"credentialResolver": {
					"kind": "integration_connection",
					"connectionId": "icn_github",
					"secretType": "github_app_installation_token",
					"resolverKey": "github_app_installation_token"
				},
				"requestMiddleware": ["append-session-link-to-github-markdown-body"]
			}
		],
		"artifacts": [],
		"workspaceSources": [],
		"runtimeClients": [],
		"agentRuntimes": []
	}`)

	assertEqual(t, len(runtimePlan.EgressRoutes), 1)
	route := runtimePlan.EgressRoutes[0]
	assertEqual(t, route.FamilyID, "github")
	assertEqual(t, route.VariantID, "github-default")
	assertEqual(t, route.AuthInjection.Type, CompiledEgressRouteAuthInjectionBearer)
	if route.AuthInjection.Target == nil {
		t.Fatalf("expected auth injection target to decode")
	}
	assertEqual(t, *route.AuthInjection.Target, "authorization")
	assertEqual(t, route.AdditionalHeaders["accept"], "application/vnd.github+json")
	assertEqual(t, len(route.RequestMiddleware), 1)
	assertEqual(t, route.RequestMiddleware[0], "append-session-link-to-github-markdown-body")
	assertEqual(t, len(route.AdditionalCredentialHeaders), 1)
	credentialHeader := route.AdditionalCredentialHeaders[0]
	assertEqual(t, credentialHeader.Header, "x-extra-token")
	assertEqual(t, credentialHeader.CredentialResolver.Kind, CompiledEgressRouteCredentialResolverIntegrationConnection)
	assertEqual(t, credentialHeader.CredentialResolver.ConnectionID, "icn_extra")
	if credentialHeader.CredentialResolver.SlotKey == nil {
		t.Fatalf("expected additional credential slotKey to decode")
	}
	assertEqual(t, *credentialHeader.CredentialResolver.SlotKey, "extra")
	assertEqual(t, route.CredentialResolver.ConnectionID, "icn_github")
	if route.CredentialResolver.ResolverKey == nil {
		t.Fatalf("expected route credential resolverKey to decode")
	}
	assertEqual(t, *route.CredentialResolver.ResolverKey, "github_app_installation_token")
}

func TestCompiledRuntimePlanDecodesAWSSigV4AuthInjectionShape(t *testing.T) {
	route := decodeSingleEgressRouteForRuntimePlanTest(t, `{
		"egressRuleId": "egress_rule_bind_s3",
		"bindingId": "bind_s3",
		"familyId": "aws",
		"variantId": "aws-default",
		"match": {
			"hosts": ["s3.amazonaws.com"]
		},
		"upstream": {
			"baseUrl": "https://s3.amazonaws.com"
		},
		"authInjection": {
			"type": "aws_sigv4",
			"service": "s3",
			"region": "us-east-1"
		},
		"credentialResolver": {
			"kind": "integration_connection",
			"connectionId": "icn_aws",
			"secretType": "aws_access_key"
		}
	}`)

	assertEqual(t, route.AuthInjection.Type, CompiledEgressRouteAuthInjectionAWSSigV4)
	if route.AuthInjection.Service == nil {
		t.Fatalf("expected sigv4 service to decode")
	}
	assertEqual(t, *route.AuthInjection.Service, "s3")
	if route.AuthInjection.Region == nil {
		t.Fatalf("expected sigv4 region to decode")
	}
	assertEqual(t, *route.AuthInjection.Region, "us-east-1")
	if route.AuthInjection.Target != nil {
		t.Fatalf("expected sigv4 target to be absent, got %q", *route.AuthInjection.Target)
	}
}

func TestCompiledRuntimePlanDecodesLinkedPrincipalCredentialResolverShape(t *testing.T) {
	route := decodeSingleEgressRouteForRuntimePlanTest(t, `{
		"egressRuleId": "egress_rule_bind_github_user",
		"bindingId": "bind_github_user",
		"familyId": "github",
		"variantId": "github-cloud",
		"match": {
			"hosts": ["api.github.com"]
		},
		"upstream": {
			"baseUrl": "https://api.github.com"
		},
		"authInjection": {
			"type": "bearer",
			"target": "authorization"
		},
		"credentialResolver": {
			"kind": "linked_principal",
			"providerFamily": "github",
			"integrationConnectionId": "conn_github",
			"credentialKind": "github_app_user_access_token",
			"actingUserRequired": true,
			"resolutionMode": "preferred"
		}
	}`)

	resolver := route.CredentialResolver
	assertEqual(t, resolver.Kind, CompiledEgressRouteCredentialResolverLinkedPrincipal)
	assertEqual(t, resolver.ProviderFamily, "github")
	assertEqual(t, resolver.IntegrationConnectionID, "conn_github")
	if resolver.CredentialKind == nil {
		t.Fatalf("expected linked principal credentialKind to decode")
	}
	assertEqual(t, *resolver.CredentialKind, "github_app_user_access_token")
	assertEqual(t, resolver.ActingUserRequired, true)
	assertEqual(t, resolver.ResolutionMode, CompiledLinkedPrincipalEgressCredentialResolutionPreferred)
}

func TestCompiledRuntimePlanDecodesMistleMCPTokenCredentialResolverShape(t *testing.T) {
	route := decodeSingleEgressRouteForRuntimePlanTest(t, `{
		"egressRuleId": "egress_rule_platform_mistle_mcp",
		"bindingId": "platform-mistle-mcp",
		"familyId": "mistle",
		"variantId": "mistle-mcp",
		"match": {
			"hosts": ["mcp.mistle.test"],
			"pathPrefixes": ["/mcp"]
		},
		"upstream": {
			"baseUrl": "https://mcp.mistle.test/mcp"
		},
		"authInjection": {
			"type": "bearer",
			"target": "authorization"
		},
		"credentialResolver": {
			"kind": "mistle_mcp_token",
			"apiKeyId": "apk_01k00000000000000000000000"
		}
	}`)

	assertEqual(t, route.CredentialResolver.Kind, CompiledEgressRouteCredentialResolverMistleMCPToken)
	assertEqual(t, route.CredentialResolver.APIKeyID, "apk_01k00000000000000000000000")
}

func TestCompiledRuntimePlanDecodesMistleMCPSetupAssistantTokenCredentialResolverShape(t *testing.T) {
	route := decodeSingleEgressRouteForRuntimePlanTest(t, `{
		"egressRuleId": "egress_rule_platform_mistle_mcp",
		"bindingId": "platform-mistle-mcp",
		"familyId": "mistle",
		"variantId": "mistle-mcp",
		"match": {
			"hosts": ["mcp.mistle.test"],
			"pathPrefixes": ["/mcp"]
		},
		"upstream": {
			"baseUrl": "https://mcp.mistle.test/mcp"
		},
		"authInjection": {
			"type": "bearer",
			"target": "authorization"
		},
		"credentialResolver": {
			"kind": "mistle_mcp_setup_assistant_token",
			"sandboxProfileId": "sbp_01k00000000000000000000000",
			"sandboxProfileVersion": 1
		}
	}`)

	assertEqual(t, route.CredentialResolver.Kind, CompiledEgressRouteCredentialResolverMistleMCPSetupAssistantToken)
	assertEqual(t, route.CredentialResolver.SandboxProfileID, "sbp_01k00000000000000000000000")
	assertEqual(t, route.CredentialResolver.SandboxProfileVersion, uint32(1))
}

func TestCompiledRuntimePlanDecodesSkillsSelection(t *testing.T) {
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
		"workspaceSources": [],
		"skills": {
			"originUrl": "https://github.com/acme/skills.git",
			"selectedSkills": [
				{
					"name": "triage",
					"relativePath": "skills/triage"
				}
			]
		},
		"runtimeClients": [],
		"agentRuntimes": []
	}`), &runtimePlan)
	if err != nil {
		t.Fatalf("expected runtime plan to decode, got %v", err)
	}
	if runtimePlan.Skills == nil {
		t.Fatalf("expected skills to decode")
	}
	assertEqual(t, runtimePlan.Skills.OriginURL, "https://github.com/acme/skills.git")
	assertEqual(t, len(runtimePlan.Skills.SelectedSkills), 1)
	assertEqual(t, runtimePlan.Skills.SelectedSkills[0].Name, "triage")
	assertEqual(t, runtimePlan.Skills.SelectedSkills[0].RelativePath, "skills/triage")
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}

func decodeSingleEgressRouteForRuntimePlanTest(t *testing.T, payload string) CompiledEgressRoute {
	t.Helper()
	runtimePlan := decodePlanForRuntimePlanTest(t, `{
		"sandboxProfileId": "sbp_runtime_plan",
		"version": 1,
		"image": {
			"source": "base",
			"imageRef": "registry.example.test/base:latest"
		},
		"setupScript": null,
		"egressRoutes": [`+payload+`],
		"artifacts": [],
		"workspaceSources": [],
		"runtimeClients": [],
		"agentRuntimes": []
	}`)
	assertEqual(t, len(runtimePlan.EgressRoutes), 1)
	return runtimePlan.EgressRoutes[0]
}

func decodePlanForRuntimePlanTest(t *testing.T, payload string) CompiledRuntimePlan {
	t.Helper()
	var runtimePlan CompiledRuntimePlan
	if err := json.Unmarshal([]byte(payload), &runtimePlan); err != nil {
		t.Fatalf("expected runtime plan to decode, got %v", err)
	}
	return runtimePlan
}

func mutateRuntimePlanValidationFixture(t *testing.T, mutate func(t *testing.T, value map[string]any)) string {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal([]byte(runtimePlanValidationFixture()), &value); err != nil {
		t.Fatalf("expected fixture to decode for mutation, got %v", err)
	}
	mutate(t, value)
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("expected mutated fixture to encode, got %v", err)
	}
	return string(payload)
}

func deleteRuntimePlanValidationFixtureHTTPReadinessField(field string) func(t *testing.T, value map[string]any) {
	return func(t *testing.T, value map[string]any) {
		t.Helper()
		delete(runtimePlanValidationFixtureProcess(t, value)["readiness"].(map[string]any), field)
	}
}

func renameRuntimePlanValidationFixtureHTTPReadinessField(from string, to string) func(t *testing.T, value map[string]any) {
	return func(t *testing.T, value map[string]any) {
		t.Helper()
		renameRuntimePlanValidationFixtureField(runtimePlanValidationFixtureProcess(t, value)["readiness"].(map[string]any), from, to)
	}
}

func deleteRuntimePlanValidationFixtureStopField(field string) func(t *testing.T, value map[string]any) {
	return func(t *testing.T, value map[string]any) {
		t.Helper()
		delete(runtimePlanValidationFixtureProcess(t, value)["stop"].(map[string]any), field)
	}
}

func renameRuntimePlanValidationFixtureStopField(from string, to string) func(t *testing.T, value map[string]any) {
	return func(t *testing.T, value map[string]any) {
		t.Helper()
		renameRuntimePlanValidationFixtureField(runtimePlanValidationFixtureProcess(t, value)["stop"].(map[string]any), from, to)
	}
}

func deleteRuntimePlanValidationFixtureEndpointTransportField(field string) func(t *testing.T, value map[string]any) {
	return func(t *testing.T, value map[string]any) {
		t.Helper()
		endpoint := firstObjectInRuntimePlanValidationFixtureArray(t, firstObjectInRuntimePlanValidationFixtureArray(t, value, "runtimeClients"), "endpoints")
		delete(endpoint["transport"].(map[string]any), field)
	}
}

func deleteRuntimePlanValidationFixtureWorkspaceSourceField(field string) func(t *testing.T, value map[string]any) {
	return func(t *testing.T, value map[string]any) {
		t.Helper()
		delete(firstObjectInRuntimePlanValidationFixtureArray(t, value, "workspaceSources"), field)
	}
}

func deleteRuntimePlanValidationFixtureCredentialResolverField(field string) func(t *testing.T, value map[string]any) {
	return func(t *testing.T, value map[string]any) {
		t.Helper()
		route := firstObjectInRuntimePlanValidationFixtureArray(t, value, "egressRoutes")
		delete(route["credentialResolver"].(map[string]any), field)
	}
}

func deleteRuntimePlanValidationFixtureAuthInjectionField(field string) func(t *testing.T, value map[string]any) {
	return func(t *testing.T, value map[string]any) {
		t.Helper()
		route := firstObjectInRuntimePlanValidationFixtureArray(t, value, "egressRoutes")
		delete(route["authInjection"].(map[string]any), field)
	}
}

func runtimePlanValidationFixtureProcess(t *testing.T, value map[string]any) map[string]any {
	t.Helper()
	client := firstObjectInRuntimePlanValidationFixtureArray(t, value, "runtimeClients")
	return firstObjectInRuntimePlanValidationFixtureArray(t, client, "processes")
}

func firstObjectInRuntimePlanValidationFixtureArray(t *testing.T, value map[string]any, key string) map[string]any {
	t.Helper()
	items, ok := value[key].([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("expected fixture %s array", key)
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected fixture %s first item object", key)
	}
	return item
}

func renameRuntimePlanValidationFixtureField(value map[string]any, from string, to string) {
	value[to] = value[from]
	delete(value, from)
}

func runtimePlanValidationFixture() string {
	return `{
		"sandboxProfileId": "sbp_runtime_plan",
		"version": 1,
		"image": {
			"source": "base",
			"imageRef": "registry.example.test/base:latest"
		},
		"setupScript": null,
		"egressRoutes": [
			{
				"egressRuleId": "rule_1",
				"bindingId": "binding_1",
				"familyId": "family_1",
				"variantId": "variant_1",
				"match": {
					"hosts": ["api.example.test"],
					"pathPrefixes": ["/"],
					"methods": ["GET"]
				},
				"upstream": {
					"baseUrl": "https://api.example.test"
				},
				"authInjection": {
					"type": "bearer"
				},
				"additionalHeaders": {},
				"additionalCredentialHeaders": [],
					"credentialResolver": {
						"kind": "linked_principal",
						"providerFamily": "github",
						"integrationConnectionId": "conn_github",
						"actingUserRequired": true,
						"resolutionMode": "required"
					},
				"requestMiddleware": []
			}
		],
		"artifacts": [
			{
				"artifactKey": "setup",
				"name": "Setup",
				"env": {},
				"lifecycle": {
					"install": [
						{
							"op": "exec",
							"command": {"args": ["true"]}
						}
					]
				}
			}
		],
		"workspaceSources": [
			{
				"sourceKind": "git-clone",
				"resourceKind": "repository",
				"path": "/workspace",
				"originUrl": "https://example.test/repo.git"
			}
		],
		"runtimeClients": [
			{
				"clientId": "client",
				"setup": {
					"env": {},
					"files": [
						{
							"fileId": "settings",
							"path": "/tmp/settings.json",
							"mode": 420,
							"content": "{}",
							"writeMode": "overwrite"
						}
					],
					"launchArgs": []
				},
				"processes": [
					{
						"processKey": "server",
						"command": {"args": ["sleep", "60"]},
						"readiness": {
								"type": "http",
								"url": "http://127.0.0.1:3000/health",
								"expectedStatus": 200,
								"timeoutMs": 1000
							},
							"stop": {
								"signal": "sigterm",
								"timeoutMs": 1000
							}
					}
				],
				"endpoints": [
					{
						"endpointKey": "http",
						"processKey": "server",
						"transport": {
							"type": "ws",
							"url": "ws://127.0.0.1:3000/agent"
						},
						"connectionMode": "dedicated"
					}
				]
			}
		],
		"agentRuntimes": []
	}`
}
