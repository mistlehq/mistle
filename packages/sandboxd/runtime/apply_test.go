package runtime

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mistle/sandboxd/command"
)

func TestApplyCompiledRuntimePlanWritesRuntimeClientSetupFiles(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "client/settings.json")
	runtimePlan := decodeRuntimePlan(t, `{
		"sandboxProfileId": "sbp_runtime_apply",
		"version": 1,
		"image": {
			"source": "base",
			"imageRef": "registry.example.test/base:latest"
		},
		"egressRoutes": [],
		"artifacts": [],
		"workspaceSources": [],
		"runtimeClients": [
			{
				"clientId": "codex-cli",
				"setup": {
					"env": {},
					"files": [
						{
							"fileId": "settings",
							"path": `+quoteJSON(targetPath)+`,
							"mode": 416,
							"content": "{\"ok\":true}\n"
						}
					],
					"launchArgs": []
				},
				"processes": [],
				"endpoints": []
			}
		],
		"agentRuntimes": []
	}`)

	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))

	assertEqual(t, readFile(t, targetPath), "{\"ok\":true}\n")
	assertEqual(t, fileMode(t, targetPath), os.FileMode(0o640))
}

func TestApplyCompiledRuntimePlanRunsArtifactExecInstallBeforeRuntimeClientSetupFiles(t *testing.T) {
	tempDir := t.TempDir()
	artifactOutputPath := filepath.Join(tempDir, "artifact.txt")
	runtimeFilePath := filepath.Join(tempDir, "runtime.txt")
	runtimePlan := CompiledRuntimePlan{
		Artifacts: []CompiledRuntimeArtifact{
			{
				ArtifactKey: "agent-cli",
				Name:        "Agent CLI",
				Lifecycle: RuntimeArtifactLifecycle{
					Install: []RuntimeArtifactInstallStep{
						{
							Op: RuntimeArtifactInstallOpExec,
							Command: RuntimeExecCommand{
								Args: []string{
									"/bin/sh",
									"-c",
									"printf '%s:%s' \"$MISTLE_MANAGED\" \"$STEP_ENV\" > \"$1\"",
									"sh",
									artifactOutputPath,
								},
								Env: map[string]string{"STEP_ENV": "step"},
							},
						},
					},
				},
			},
		},
		RuntimeClients: []RuntimeClient{
			{
				ClientID: "codex-cli",
				Setup: RuntimeClientSetup{
					Files: []RuntimeClientSetupFile{
						{
							FileID:  "runtime-file",
							Path:    runtimeFilePath,
							Mode:    0o640,
							Content: "runtime file\n",
						},
					},
				},
			},
		},
	}

	requireNoError(t, ApplyCompiledRuntimePlanWithEnvironment(runtimePlan, map[string]string{"MISTLE_MANAGED": "managed"}))

	assertEqual(t, readFile(t, artifactOutputPath), "managed:step")
	assertEqual(t, readFile(t, runtimeFilePath), "runtime file\n")
}

func TestApplyCompiledRuntimePlanStreamsArtifactExecOutputToSink(t *testing.T) {
	outputSink := &recordingOutputSink{}
	runtimePlan := CompiledRuntimePlan{
		Artifacts: []CompiledRuntimeArtifact{
			{
				ArtifactKey: "agent-cli",
				Name:        "Agent CLI",
				Lifecycle: RuntimeArtifactLifecycle{
					Install: []RuntimeArtifactInstallStep{
						{
							Op: RuntimeArtifactInstallOpExec,
							Command: RuntimeExecCommand{
								Args: []string{
									"/bin/sh",
									"-c",
									"printf artifact-stdout; printf artifact-stderr >&2",
								},
							},
						},
					},
				},
			},
		},
	}

	requireNoError(t, ApplyCompiledRuntimePlanWithEnvironmentOutputSinkAndObserver(runtimePlan, nil, outputSink, nil))

	assertEqual(t, outputSink.stdout, "artifact-stdout")
	assertEqual(t, outputSink.stderr, "artifact-stderr")
}

func TestApplyCompiledRuntimePlanNotifiesObserverForAppliedLifecycleSections(t *testing.T) {
	tempDir := t.TempDir()
	artifactOutputPath := filepath.Join(tempDir, "artifact.txt")
	sourceRepoPath := filepath.Join(tempDir, "source")
	targetPath := filepath.Join(tempDir, "workspace")
	runtimeFilePath := filepath.Join(tempDir, "runtime.txt")
	createGitRepository(t, sourceRepoPath)
	requireNoError(t, os.WriteFile(filepath.Join(sourceRepoPath, "README.md"), []byte("workspace source\n"), 0o644))
	gitCommitAll(t, sourceRepoPath, "initial")
	observer := &recordingRuntimePlanApplyObserver{}
	runtimePlan := CompiledRuntimePlan{
		Artifacts: []CompiledRuntimeArtifact{
			{
				ArtifactKey: "agent-cli",
				Name:        "Agent CLI",
				Lifecycle: RuntimeArtifactLifecycle{
					Install: []RuntimeArtifactInstallStep{
						{
							Op: RuntimeArtifactInstallOpExec,
							Command: RuntimeExecCommand{
								Args: []string{"/bin/sh", "-c", "printf artifact > \"$1\"", "sh", artifactOutputPath},
							},
						},
					},
				},
			},
		},
		WorkspaceSources: []CompiledWorkspaceSource{
			{
				SourceKind:   WorkspaceSourceKindGitClone,
				ResourceKind: WorkspaceSourceResourceKindRepository,
				Path:         targetPath,
				OriginURL:    sourceRepoPath,
			},
		},
		RuntimeClients: []RuntimeClient{
			{
				ClientID: "codex-cli",
				Setup: RuntimeClientSetup{
					Files: []RuntimeClientSetupFile{
						{
							FileID:  "runtime-file",
							Path:    runtimeFilePath,
							Mode:    0o640,
							Content: "runtime file\n",
						},
					},
				},
			},
		},
	}

	requireNoError(t, ApplyCompiledRuntimePlanWithEnvironmentAndObserver(runtimePlan, nil, observer))

	assertStringSlicesEqual(t, observer.events, []string{
		"start:runtime_artifacts",
		"complete:runtime_artifacts",
		"start:workspace_sources",
		"complete:workspace_sources",
		"start:runtime_files",
		"complete:runtime_files",
	})
}

func TestApplyCompiledRuntimePlanReportsArtifactInstallContextWhenCommandEnvUsesReservedManagedEnv(t *testing.T) {
	runtimePlan := CompiledRuntimePlan{
		Artifacts: []CompiledRuntimeArtifact{
			{
				ArtifactKey: "agent-cli",
				Name:        "Agent CLI",
				Lifecycle: RuntimeArtifactLifecycle{
					Install: []RuntimeArtifactInstallStep{
						{
							Op: RuntimeArtifactInstallOpExec,
							Command: RuntimeExecCommand{
								Args: []string{"/bin/sh", "-c", "true"},
								Env:  map[string]string{"MISTLE_MANAGED": "step"},
							},
						},
					},
				},
			},
		},
	}

	err := ApplyCompiledRuntimePlanWithEnvironment(runtimePlan, map[string]string{"MISTLE_MANAGED": "managed"})

	if err == nil {
		t.Fatalf("expected artifact install error")
	}
	assertEqual(t, err.Error(), "runtime plan artifacts[0] lifecycle.install[0] failed (artifactKey=agent-cli op=exec): artifact install command env defines managed env 'MISTLE_MANAGED', which sandboxd reserves")
}

func TestApplyCompiledRuntimePlanInstallsGitHubReleaseBinaryAsset(t *testing.T) {
	binaryPayload := []byte("#!/bin/sh\necho tool\n")
	simulatedGitHub := startSimulatedGitHubReleaseServer(t, map[string][]byte{
		"/acme/tool/releases/download/v1.2.3/tool-linux-amd64": binaryPayload,
	})
	installDir := filepath.Join(t.TempDir(), "bin")
	requireNoError(t, os.MkdirAll(installDir, 0o755))
	installPath := filepath.Join(installDir, "tool")
	runtimePlan := githubReleaseRuntimePlan(
		installPath,
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName: "tool-linux-amd64",
			Format:   RuntimeArtifactGitHubReleaseAssetFormatBinary,
			SHA256:   stringPointer(sha256Hex(binaryPayload)),
		},
	)

	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))

	assertEqual(t, readFile(t, installPath), string(binaryPayload))
	assertEqual(t, fileMode(t, installPath), os.FileMode(0o755))
	assertEqual(t, simulatedGitHub.requestCount, 1)
}

func TestApplyCompiledRuntimePlanInstallsGitHubReleaseTarGzExtractedAsset(t *testing.T) {
	archivePayload := createTarGz(t, "tool_1.2.3/bin/tool", []byte("#!/bin/sh\necho archived\n"))
	simulatedGitHub := startSimulatedGitHubReleaseServer(t, map[string][]byte{
		"/acme/tool/releases/download/v1.2.3/tool-linux-amd64.tar.gz": archivePayload,
	})
	installDir := filepath.Join(t.TempDir(), "bin")
	requireNoError(t, os.MkdirAll(installDir, 0o755))
	installPath := filepath.Join(installDir, "tool")
	runtimePlan := githubReleaseRuntimePlan(
		installPath,
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName:      "tool-linux-amd64.tar.gz",
			Format:        RuntimeArtifactGitHubReleaseAssetFormatTarGz,
			ExtractedPath: "tool_1.2.3/bin/tool",
			SHA256:        stringPointer(sha256Hex(archivePayload)),
		},
	)

	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))

	assertEqual(t, readFile(t, installPath), "#!/bin/sh\necho archived\n")
	assertEqual(t, fileMode(t, installPath), os.FileMode(0o755))
	assertEqual(t, simulatedGitHub.requestCount, 1)
}

func TestApplyCompiledRuntimePlanInstallsGitHubReleaseTarGzDirectoryWithEntryModes(t *testing.T) {
	archivePayload := createTarGzEntries(t, []tarEntry{
		{name: "tool_1.2.3/bin", mode: 0o755, directory: true},
		{name: "tool_1.2.3/bin/tool", mode: 0o755, payload: []byte("#!/bin/sh\necho archived\n")},
		{name: "tool_1.2.3/README.md", mode: 0o644, payload: []byte("readme\n")},
	})
	simulatedGitHub := startSimulatedGitHubReleaseServer(t, map[string][]byte{
		"/acme/tool/releases/download/v1.2.3/tool-linux-amd64.tar.gz": archivePayload,
	})
	installDir := filepath.Join(t.TempDir(), "opt")
	requireNoError(t, os.MkdirAll(installDir, 0o755))
	installPath := filepath.Join(installDir, "tool")
	runtimePlan := githubReleaseRuntimePlan(
		installPath,
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName:      "tool-linux-amd64.tar.gz",
			Format:        RuntimeArtifactGitHubReleaseAssetFormatTarGz,
			ExtractedPath: "tool_1.2.3",
			SHA256:        stringPointer(sha256Hex(archivePayload)),
		},
	)

	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))

	assertEqual(t, readFile(t, filepath.Join(installPath, "bin", "tool")), "#!/bin/sh\necho archived\n")
	assertEqual(t, fileMode(t, filepath.Join(installPath, "bin", "tool")), os.FileMode(0o755))
	assertEqual(t, fileMode(t, filepath.Join(installPath, "README.md")), os.FileMode(0o644))
	assertEqual(t, simulatedGitHub.requestCount, 1)
}

func TestApplyCompiledRuntimePlanRejectsGitHubReleaseTarGzEntryEscapingExtractedPath(t *testing.T) {
	archivePayload := createTarGzEntries(t, []tarEntry{
		{name: "tool/../outside", mode: 0o755, payload: []byte("escape\n")},
		{name: "tool/bin/tool", mode: 0o755, payload: []byte("#!/bin/sh\necho archived\n")},
	})
	simulatedGitHub := startSimulatedGitHubReleaseServer(t, map[string][]byte{
		"/acme/tool/releases/download/v1.2.3/tool-linux-amd64.tar.gz": archivePayload,
	})
	installDir := filepath.Join(t.TempDir(), "opt")
	requireNoError(t, os.MkdirAll(installDir, 0o755))
	runtimePlan := githubReleaseRuntimePlan(
		filepath.Join(installDir, "tool"),
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName:      "tool-linux-amd64.tar.gz",
			Format:        RuntimeArtifactGitHubReleaseAssetFormatTarGz,
			ExtractedPath: "tool",
		},
	)

	err := ApplyCompiledRuntimePlan(runtimePlan)

	if err == nil {
		t.Fatalf("expected archive extraction error")
	}
	if !containsString(err.Error(), "github release tar.gz entry tool/../outside escapes extractedPath") {
		t.Fatalf("expected extractedPath escape error, got %v", err)
	}
	assertEqual(t, simulatedGitHub.requestCount, 1)
}

func TestMaterializeGitHubReleaseAssetHonorsExpiredInstallBudget(t *testing.T) {
	tempDir := t.TempDir()
	downloadPath := filepath.Join(tempDir, "downloaded-asset")
	requireNoError(t, os.WriteFile(downloadPath, []byte("#!/bin/sh\necho tool\n"), 0o644))
	installPath := filepath.Join(tempDir, "tool")
	timeoutMS := uint64(1)
	budget := githubInstallBudget{timeoutMS: &timeoutMS, startedAt: time.Now().Add(-time.Second)}

	err := materializeGitHubReleaseAsset(
		&installWorkspace{
			tempDir:      tempDir,
			downloadPath: downloadPath,
			stagedPath:   filepath.Join(tempDir, "staged-asset"),
			installPath:  installPath,
		},
		RuntimeArtifactGitHubReleaseAssetShape{Format: RuntimeArtifactGitHubReleaseAssetFormatBinary},
		budget,
	)

	if err == nil {
		t.Fatalf("expected expired budget to fail materialization")
	}
	if !containsString(err.Error(), "github release install timed out after 1ms") {
		t.Fatalf("expected timeout error, got %v", err)
	}
	if _, statErr := os.Stat(installPath); !os.IsNotExist(statErr) {
		t.Fatalf("expected install path not to be finalized after timeout, stat err=%v", statErr)
	}
}

func TestApplyCompiledRuntimePlanRequiresExistingGitHubReleaseInstallParent(t *testing.T) {
	binaryPayload := []byte("#!/bin/sh\necho tool\n")
	simulatedGitHub := startSimulatedGitHubReleaseServer(t, map[string][]byte{
		"/acme/tool/releases/download/v1.2.3/tool-linux-amd64": binaryPayload,
	})
	installPath := filepath.Join(t.TempDir(), "missing-bin", "tool")
	runtimePlan := githubReleaseRuntimePlan(
		installPath,
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName: "tool-linux-amd64",
			Format:   RuntimeArtifactGitHubReleaseAssetFormatBinary,
		},
	)

	err := ApplyCompiledRuntimePlan(runtimePlan)

	if err == nil {
		t.Fatalf("expected missing install parent to fail")
	}
	if !containsString(err.Error(), "github release install parent directory does not exist") {
		t.Fatalf("expected install parent error, got %v", err)
	}
	assertEqual(t, simulatedGitHub.requestCount, 0)
}

func TestApplyCompiledRuntimePlanCleansGitHubReleaseInstallWorkspaceAfterSuccess(t *testing.T) {
	binaryPayload := []byte("#!/bin/sh\necho tool\n")
	simulatedGitHub := startSimulatedGitHubReleaseServer(t, map[string][]byte{
		"/acme/tool/releases/download/v1.2.3/tool-linux-amd64": binaryPayload,
	})
	installDir := filepath.Join(t.TempDir(), "bin")
	requireNoError(t, os.MkdirAll(installDir, 0o755))
	installPath := filepath.Join(installDir, "tool")
	runtimePlan := githubReleaseRuntimePlan(
		installPath,
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName: "tool-linux-amd64",
			Format:   RuntimeArtifactGitHubReleaseAssetFormatBinary,
		},
	)

	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))

	matches, err := filepath.Glob(filepath.Join(installDir, ".mistle-artifact-*"))
	requireNoError(t, err)
	assertEqual(t, len(matches), 0)
	assertEqual(t, simulatedGitHub.requestCount, 1)
}

func TestApplyCompiledRuntimePlanReportsGitHubReleaseChecksumMismatch(t *testing.T) {
	simulatedGitHub := startSimulatedGitHubReleaseServer(t, map[string][]byte{
		"/acme/tool/releases/download/v1.2.3/tool-linux-amd64": []byte("actual"),
	})
	installDir := filepath.Join(t.TempDir(), "bin")
	requireNoError(t, os.MkdirAll(installDir, 0o755))
	installPath := filepath.Join(installDir, "tool")
	runtimePlan := githubReleaseRuntimePlan(
		installPath,
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName: "tool-linux-amd64",
			Format:   RuntimeArtifactGitHubReleaseAssetFormatBinary,
			SHA256:   stringPointer(sha256Hex([]byte("expected"))),
		},
	)

	err := ApplyCompiledRuntimePlan(runtimePlan)

	if err == nil {
		t.Fatalf("expected checksum error")
	}
	assertEqual(t, simulatedGitHub.requestCount, 1)
	if !containsString(err.Error(), "sha256 mismatch expected") {
		t.Fatalf("expected checksum mismatch error, got %v", err)
	}
}

func TestApplyCompiledRuntimePlanRetriesTransientGitHubReleaseAssetFailures(t *testing.T) {
	binaryPayload := []byte("#!/bin/sh\necho retried\n")
	withGitHubRetryBackoffs(t, []time.Duration{time.Millisecond, time.Millisecond})
	simulatedGitHub := startSimulatedGitHubReleaseServer(t, map[string][]byte{
		"/acme/tool/releases/download/v1.2.3/tool-linux-amd64": binaryPayload,
	})
	simulatedGitHub.statuses["/acme/tool/releases/download/v1.2.3/tool-linux-amd64"] = []int{http.StatusBadGateway}
	installDir := filepath.Join(t.TempDir(), "bin")
	requireNoError(t, os.MkdirAll(installDir, 0o755))
	installPath := filepath.Join(installDir, "tool")
	runtimePlan := githubReleaseRuntimePlan(
		installPath,
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName: "tool-linux-amd64",
			Format:   RuntimeArtifactGitHubReleaseAssetFormatBinary,
		},
	)

	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))

	assertEqual(t, readFile(t, installPath), string(binaryPayload))
	assertEqual(t, simulatedGitHub.requestCount, 2)
	assertEqual(t, len(simulatedGitHub.userAgents), 2)
	for _, userAgent := range simulatedGitHub.userAgents {
		assertEqual(t, userAgent, githubInstallerUserAgent)
	}
}

func TestApplyCompiledRuntimePlanReportsPersistentGitHubReleaseAssetStatusDetails(t *testing.T) {
	withGitHubRetryBackoffs(t, []time.Duration{time.Millisecond, time.Millisecond})
	simulatedGitHub := startSimulatedGitHubReleaseServer(t, map[string][]byte{})
	simulatedGitHub.statuses["/acme/tool/releases/download/v1.2.3/tool-linux-amd64"] = []int{
		http.StatusBadGateway,
		http.StatusBadGateway,
		http.StatusBadGateway,
	}
	installPath := filepath.Join(t.TempDir(), "bin", "tool")
	requireNoError(t, os.MkdirAll(filepath.Dir(installPath), 0o755))
	runtimePlan := githubReleaseRuntimePlan(
		installPath,
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName: "tool-linux-amd64",
			Format:   RuntimeArtifactGitHubReleaseAssetFormatBinary,
		},
	)

	err := ApplyCompiledRuntimePlan(runtimePlan)

	if err == nil {
		t.Fatalf("expected persistent GitHub release asset error")
	}
	errorText := err.Error()
	for _, expected := range []string{
		"http 502",
		"after 3 attempts",
		"url=" + simulatedGitHub.baseURL + "/acme/tool/releases/download/v1.2.3/tool-linux-amd64",
		"host=" + strings.TrimPrefix(simulatedGitHub.baseURL, "http://"),
	} {
		if !containsString(errorText, expected) {
			t.Fatalf("expected error to contain %q, got %v", expected, err)
		}
	}
	assertEqual(t, simulatedGitHub.requestCount, 3)
}

func TestApplyCompiledRuntimePlanRetriesGitHubRateLimitAndForbiddenResponses(t *testing.T) {
	binaryPayload := []byte("#!/bin/sh\necho retried statuses\n")
	withGitHubRetryBackoffs(t, []time.Duration{time.Millisecond, time.Millisecond})
	simulatedGitHub := startSimulatedGitHubReleaseServer(t, map[string][]byte{
		"/acme/tool/releases/download/v1.2.3/tool-linux-amd64": binaryPayload,
	})
	simulatedGitHub.statuses["/acme/tool/releases/download/v1.2.3/tool-linux-amd64"] = []int{http.StatusForbidden, http.StatusTooManyRequests}
	installPath := filepath.Join(t.TempDir(), "bin", "tool")
	requireNoError(t, os.MkdirAll(filepath.Dir(installPath), 0o755))
	runtimePlan := githubReleaseRuntimePlan(
		installPath,
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName: "tool-linux-amd64",
			Format:   RuntimeArtifactGitHubReleaseAssetFormatBinary,
		},
	)

	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))

	assertEqual(t, readFile(t, installPath), string(binaryPayload))
	assertEqual(t, simulatedGitHub.requestCount, 3)
}

func TestApplyCompiledRuntimePlanRetriesPartialGitHubDownloadAndTruncatesStagingFile(t *testing.T) {
	binaryPayload := []byte("complete")
	withGitHubRetryBackoffs(t, []time.Duration{time.Millisecond, time.Millisecond})
	var downloadAttempts int
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/acme/tool/releases/download/v1.2.3/tool-linux-amd64" {
			http.NotFound(responseWriter, request)
			return
		}
		downloadAttempts++
		if downloadAttempts == 1 {
			responseWriter.Header().Set("Content-Length", "64")
			_, _ = responseWriter.Write([]byte("partial"))
			if flusher, ok := responseWriter.(http.Flusher); ok {
				flusher.Flush()
			}
			return
		}
		_, _ = responseWriter.Write(binaryPayload)
	}))
	defer server.Close()
	previousBaseURL := githubReleasesBaseURL
	githubReleasesBaseURL = server.URL
	t.Cleanup(func() {
		githubReleasesBaseURL = previousBaseURL
	})
	installPath := filepath.Join(t.TempDir(), "bin", "tool")
	requireNoError(t, os.MkdirAll(filepath.Dir(installPath), 0o755))
	runtimePlan := githubReleaseRuntimePlan(
		installPath,
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName: "tool-linux-amd64",
			Format:   RuntimeArtifactGitHubReleaseAssetFormatBinary,
		},
	)

	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))

	assertEqual(t, readFile(t, installPath), string(binaryPayload))
	assertEqual(t, downloadAttempts, 2)
}

func TestApplyCompiledRuntimePlanRejectsInvalidManagedGitHubProxyURL(t *testing.T) {
	installPath := filepath.Join(t.TempDir(), "bin", "tool")
	requireNoError(t, os.MkdirAll(filepath.Dir(installPath), 0o755))
	runtimePlan := githubReleaseRuntimePlan(
		installPath,
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName: "tool-linux-amd64",
			Format:   RuntimeArtifactGitHubReleaseAssetFormatBinary,
		},
	)

	err := ApplyCompiledRuntimePlanWithEnvironment(runtimePlan, map[string]string{"HTTPS_PROXY": "://bad"})

	if err == nil {
		t.Fatalf("expected invalid proxy error")
	}
	if !containsString(err.Error(), "managed HTTPS proxy configuration is invalid for github release install") {
		t.Fatalf("expected managed proxy error, got %v", err)
	}
}

func TestApplyCompiledRuntimePlanInstallsLatestGitHubReleaseAssetFromAPI(t *testing.T) {
	binaryPayload := []byte("#!/bin/sh\necho latest\n")
	installPath := filepath.Join(t.TempDir(), "bin", "tool")
	requireNoError(t, os.MkdirAll(filepath.Dir(installPath), 0o755))
	simulatedGitHub := startSimulatedGitHubServer(t, simulatedGitHubRoutes{
		api: map[string]string{
			"/repos/acme/tool/releases/latest": `{
				"tag_name": "v2.0.0",
				"draft": false,
				"prerelease": false,
				"published_at": "2026-06-01T00:00:00Z",
				"assets": [
					{
						"name": "tool-linux-amd64",
						"browser_download_url": "` + simulatedGitHubURL("/downloads/tool-linux-amd64") + `"
					}
				]
			}`,
		},
		assets: map[string][]byte{
			"/downloads/tool-linux-amd64": binaryPayload,
		},
	})
	runtimePlan := githubReleaseRuntimePlanWithRelease(
		installPath,
		RuntimeArtifactGitHubReleaseSelector{Kind: RuntimeArtifactGitHubReleaseSelectorLatest},
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName: "tool-linux-amd64",
			Format:   RuntimeArtifactGitHubReleaseAssetFormatBinary,
		},
	)

	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))

	assertEqual(t, readFile(t, installPath), string(binaryPayload))
	assertEqual(t, simulatedGitHub.requestCount, 2)
}

func TestApplyCompiledRuntimePlanInstallsLatestMatchingPrefixGitHubReleaseAssetFromAPI(t *testing.T) {
	binaryPayload := []byte("#!/bin/sh\necho prefix\n")
	installPath := filepath.Join(t.TempDir(), "bin", "tool")
	requireNoError(t, os.MkdirAll(filepath.Dir(installPath), 0o755))
	simulatedGitHub := startSimulatedGitHubServer(t, simulatedGitHubRoutes{
		api: map[string]string{
			"/repos/acme/tool/releases?page=1&per_page=100": `[
				{
					"tag_name": "tool/v2.0.0-rc1",
					"draft": false,
					"prerelease": true,
					"published_at": "2026-06-01T00:00:00Z",
					"assets": []
				},
				{
					"tag_name": "other/v1.0.0",
					"draft": false,
					"prerelease": false,
					"published_at": "2026-06-01T00:00:00Z",
					"assets": []
				}
			]`,
			"/repos/acme/tool/releases?page=2&per_page=100": `[
				{
					"tag_name": "tool/v1.2.3",
					"draft": false,
					"prerelease": false,
					"published_at": "2026-06-02T00:00:00Z",
					"assets": [
						{
							"name": "tool-linux-amd64",
							"browser_download_url": "` + simulatedGitHubURL("/downloads/tool-prefix-linux-amd64") + `"
						}
					]
				}
			]`,
		},
		assets: map[string][]byte{
			"/downloads/tool-prefix-linux-amd64": binaryPayload,
		},
	})
	runtimePlan := githubReleaseRuntimePlanWithRelease(
		installPath,
		RuntimeArtifactGitHubReleaseSelector{
			Kind:   RuntimeArtifactGitHubReleaseSelectorTag,
			Match:  RuntimeArtifactGitHubReleaseTagMatchLatestMatchingPrefix,
			Prefix: "tool/",
		},
		RuntimeArtifactGitHubReleaseAssetShape{
			FileName: "tool-linux-amd64",
			Format:   RuntimeArtifactGitHubReleaseAssetFormatBinary,
		},
	)

	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))

	assertEqual(t, readFile(t, installPath), string(binaryPayload))
	assertEqual(t, simulatedGitHub.requestCount, 3)
}

func TestApplyCompiledRuntimePlanClonesWorkspaceSourceAndRestoresOriginURL(t *testing.T) {
	tempDir := t.TempDir()
	sourceRepoPath := filepath.Join(tempDir, "source-repo")
	targetPath := filepath.Join(tempDir, "workspaces", "repo")
	originURL := "https://example.test/mistle/repo.git"

	requireNoError(t, os.MkdirAll(sourceRepoPath, 0o755))
	runCommand(t, sourceRepoPath, "git", "init")
	requireNoError(t, os.WriteFile(filepath.Join(sourceRepoPath, "README.md"), []byte("workspace source\n"), 0o644))
	runCommand(t, sourceRepoPath, "git", "add", "README.md")
	runCommand(t, sourceRepoPath, "git", "-c", "user.email=sandboxd@example.test", "-c", "user.name=sandboxd", "commit", "-m", "initial")

	runtimePlan := CompiledRuntimePlan{
		WorkspaceSources: []CompiledWorkspaceSource{
			{
				SourceKind:   WorkspaceSourceKindGitClone,
				ResourceKind: WorkspaceSourceResourceKindRepository,
				Path:         targetPath,
				OriginURL:    originURL,
				CloneURL:     &sourceRepoPath,
			},
		},
	}

	requireNoError(t, ApplyCompiledRuntimePlanWithEnvironment(runtimePlan, map[string]string{"MISTLE_TEST_ENV": "present"}))

	assertEqual(t, readFile(t, filepath.Join(targetPath, "README.md")), "workspace source\n")
	remoteOriginURL := commandOutput(t, targetPath, "git", "remote", "get-url", "origin")
	assertEqual(t, remoteOriginURL, originURL+"\n")
}

func TestApplyCompiledRuntimePlanPreservesExistingNonGitWorkspaceTarget(t *testing.T) {
	tempDir := t.TempDir()
	sourceRepoPath := filepath.Join(tempDir, "source-repo")
	targetPath := filepath.Join(tempDir, "workspaces", "repo")
	createGitRepository(t, sourceRepoPath)
	requireNoError(t, os.MkdirAll(targetPath, 0o755))
	requireNoError(t, os.WriteFile(filepath.Join(targetPath, "plain.txt"), []byte("not a repository"), 0o644))

	requireNoError(t, ApplyCompiledRuntimePlan(workspaceSourceRuntimePlan(sourceRepoPath, targetPath, nil)))

	assertEqual(t, readFile(t, filepath.Join(targetPath, "plain.txt")), "not a repository")
}

func TestApplyCompiledRuntimePlanPreservesExistingWorkspaceTargetInsideAnotherRepository(t *testing.T) {
	tempDir := t.TempDir()
	sourceRepoPath := filepath.Join(tempDir, "source-repo")
	enclosingRepoPath := filepath.Join(tempDir, "enclosing-repo")
	targetPath := filepath.Join(enclosingRepoPath, "nested", "repo")
	createGitRepository(t, sourceRepoPath)
	createGitRepository(t, enclosingRepoPath)
	requireNoError(t, os.MkdirAll(targetPath, 0o755))
	requireNoError(t, os.WriteFile(filepath.Join(targetPath, "plain.txt"), []byte("not the repo root"), 0o644))

	requireNoError(t, ApplyCompiledRuntimePlan(workspaceSourceRuntimePlan(sourceRepoPath, targetPath, nil)))

	assertEqual(t, readFile(t, filepath.Join(targetPath, "plain.txt")), "not the repo root")
}

func TestApplyCompiledRuntimePlanPreservesExistingGitWorkspaceWithOriginMismatch(t *testing.T) {
	tempDir := t.TempDir()
	sourceRepoPath := filepath.Join(tempDir, "source-repo")
	mismatchedOriginPath := filepath.Join(tempDir, "other-source-repo")
	targetPath := filepath.Join(tempDir, "workspaces", "repo")
	createGitRepository(t, sourceRepoPath)
	requireNoError(t, os.WriteFile(filepath.Join(sourceRepoPath, "README.md"), []byte("workspace source\n"), 0o644))
	gitCommitAll(t, sourceRepoPath, "initial")
	createGitRepository(t, mismatchedOriginPath)
	runtimePlan := workspaceSourceRuntimePlan(sourceRepoPath, targetPath, nil)
	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))
	runCommand(t, targetPath, "git", "remote", "set-url", "origin", mismatchedOriginPath)

	requireNoError(t, ApplyCompiledRuntimePlan(runtimePlan))

	assertEqual(t, commandOutput(t, targetPath, "git", "remote", "get-url", "origin"), mismatchedOriginPath+"\n")
}

func TestApplyCompiledRuntimePlanReportsWorkspaceSourceContextWhenManagedEnvUsesReservedGitPrompt(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "workspaces", "repo")
	cloneURL := filepath.Join(tempDir, "source-repo")
	runtimePlan := CompiledRuntimePlan{
		WorkspaceSources: []CompiledWorkspaceSource{
			{
				SourceKind:   WorkspaceSourceKindGitClone,
				ResourceKind: WorkspaceSourceResourceKindRepository,
				Path:         targetPath,
				OriginURL:    "https://example.test/mistle/repo.git",
				CloneURL:     &cloneURL,
			},
		},
	}

	err := ApplyCompiledRuntimePlanWithEnvironment(runtimePlan, map[string]string{"GIT_TERMINAL_PROMPT": "1"})

	if err == nil {
		t.Fatalf("expected workspace source error")
	}
	assertEqual(t, err.Error(), "runtime plan workspaceSources[0] failed (sourceKind=git-clone path="+targetPath+" originUrl=https://example.test/mistle/repo.git cloneUrl="+cloneURL+"): managed runtime env defines 'GIT_TERMINAL_PROMPT', which workspace clone reserves")
}

func TestApplyCompiledRuntimePlanReportsSkillsReconcileWhenSourceIsNotWorkspaceSource(t *testing.T) {
	runtimePlan := CompiledRuntimePlan{
		WorkspaceSources: []CompiledWorkspaceSource{},
		Skills: &CompiledRuntimePlanSkills{
			OriginURL: "https://github.com/acme/skills.git",
			SelectedSkills: []CompiledSkillSelection{
				{Name: "triage", RelativePath: "triage"},
			},
		},
		AgentRuntimes: []CompiledAgentRuntime{
			{RuntimeID: "codex"},
		},
	}

	err := ApplyCompiledRuntimePlan(runtimePlan)

	if err == nil {
		t.Fatalf("expected skills reconciliation error")
	}
	assertEqual(t, err.Error(), "runtime plan skills reconciliation failed (originUrl=https://github.com/acme/skills.git runtimeId=codex): skills source 'https://github.com/acme/skills.git' was not found in runtime plan workspace sources")
}

func TestApplyCompiledRuntimePlanReportsRuntimeFileContext(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "client/settings.txt")
	writeMode := RuntimeFileWriteModeMerge
	runtimePlan := CompiledRuntimePlan{
		RuntimeClients: []RuntimeClient{
			{
				ClientID: "codex-cli",
				Setup: RuntimeClientSetup{
					Files: []RuntimeClientSetupFile{
						{
							FileID:    "settings",
							Path:      targetPath,
							Mode:      0o640,
							Content:   "generated",
							WriteMode: &writeMode,
						},
					},
				},
			},
		},
	}
	requireNoError(t, os.MkdirAll(filepath.Dir(targetPath), 0o755))
	requireNoError(t, os.WriteFile(targetPath, []byte("existing"), 0o600))

	err := ApplyCompiledRuntimePlan(runtimePlan)

	if err == nil {
		t.Fatalf("expected runtime file error")
	}
	assertEqual(t, err.Error(), "runtime plan runtimeClients[0].setup.files[0] failed (clientId=codex-cli fileId=settings path="+targetPath+"): runtime file "+targetPath+" uses writeMode merge, but sandboxd could not infer a supported merge format")
}

func decodeRuntimePlan(t *testing.T, payload string) CompiledRuntimePlan {
	t.Helper()
	var runtimePlan CompiledRuntimePlan
	requireNoError(t, json.Unmarshal([]byte(payload), &runtimePlan))
	return runtimePlan
}

func quoteJSON(value string) string {
	payload, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(payload)
}

type simulatedGitHubReleaseServer struct {
	requestCount int
	baseURL      string
	statuses     map[string][]int
	userAgents   []string
}

type simulatedGitHubRoutes struct {
	api      map[string]string
	assets   map[string][]byte
	statuses map[string][]int
}

func startSimulatedGitHubReleaseServer(t *testing.T, assets map[string][]byte) *simulatedGitHubReleaseServer {
	return startSimulatedGitHubServer(t, simulatedGitHubRoutes{assets: assets})
}

// Simulates the GitHub release endpoints consumed by artifact_install.go:
// release lookup, paginated release listing, and browser_download_url asset downloads.
func startSimulatedGitHubServer(t *testing.T, routes simulatedGitHubRoutes) *simulatedGitHubReleaseServer {
	t.Helper()
	simulated := &simulatedGitHubReleaseServer{statuses: map[string][]int{}}
	for path, statuses := range routes.statuses {
		simulated.statuses[path] = append([]int(nil), statuses...)
	}
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		simulated.requestCount++
		simulated.userAgents = append(simulated.userAgents, request.Header.Get("User-Agent"))
		routeKey := request.URL.Path
		if request.URL.RawQuery != "" {
			routeKey += "?" + request.URL.RawQuery
		}
		if statuses := simulated.statuses[routeKey]; len(statuses) > 0 {
			responseWriter.WriteHeader(statuses[0])
			simulated.statuses[routeKey] = statuses[1:]
			return
		}
		if payload, ok := routes.api[routeKey]; ok {
			responseWriter.Header().Set("Content-Type", "application/json")
			payload = strings.ReplaceAll(payload, simulatedGitHubBaseURLPlaceholder, server.URL)
			_, _ = responseWriter.Write([]byte(payload))
			return
		}
		if payload, ok := routes.assets[request.URL.Path]; ok {
			_, _ = responseWriter.Write(payload)
			return
		}
		http.NotFound(responseWriter, request)
		return
	}))
	simulated.baseURL = server.URL
	t.Cleanup(server.Close)
	previousAPIBaseURL := githubAPIBaseURL
	previousBaseURL := githubReleasesBaseURL
	githubAPIBaseURL = server.URL
	githubReleasesBaseURL = server.URL
	t.Cleanup(func() {
		githubAPIBaseURL = previousAPIBaseURL
		githubReleasesBaseURL = previousBaseURL
	})
	return simulated
}

func githubReleaseRuntimePlan(installPath string, assetShape RuntimeArtifactGitHubReleaseAssetShape) CompiledRuntimePlan {
	return githubReleaseRuntimePlanWithRelease(
		installPath,
		RuntimeArtifactGitHubReleaseSelector{
			Kind:  RuntimeArtifactGitHubReleaseSelectorTag,
			Match: RuntimeArtifactGitHubReleaseTagMatchExact,
			Tag:   "v1.2.3",
		},
		assetShape,
	)
}

func githubReleaseRuntimePlanWithRelease(
	installPath string,
	release RuntimeArtifactGitHubReleaseSelector,
	assetShape RuntimeArtifactGitHubReleaseAssetShape,
) CompiledRuntimePlan {
	return CompiledRuntimePlan{
		Artifacts: []CompiledRuntimeArtifact{
			{
				ArtifactKey: "tool",
				Name:        "Tool",
				Lifecycle: RuntimeArtifactLifecycle{
					Install: []RuntimeArtifactInstallStep{
						{
							Op:          RuntimeArtifactInstallOpGitHubReleaseInstall,
							Repository:  "acme/tool",
							InstallPath: installPath,
							Release:     release,
							Asset:       RuntimeArtifactGitHubReleaseInstallAsset{Exact: assetShape},
						},
					},
				},
			},
		},
	}
}

func workspaceSourceRuntimePlan(originURL string, targetPath string, cloneURL *string) CompiledRuntimePlan {
	return CompiledRuntimePlan{
		WorkspaceSources: []CompiledWorkspaceSource{
			{
				SourceKind:   WorkspaceSourceKindGitClone,
				ResourceKind: WorkspaceSourceResourceKindRepository,
				Path:         targetPath,
				OriginURL:    originURL,
				CloneURL:     cloneURL,
			},
		},
	}
}

const simulatedGitHubBaseURLPlaceholder = "__SIMULATED_GITHUB_BASE_URL__"

func simulatedGitHubURL(path string) string {
	return simulatedGitHubBaseURLPlaceholder + path
}

func withGitHubRetryBackoffs(t *testing.T, backoffs []time.Duration) {
	t.Helper()
	previousBackoffs := githubRetryBackoffs
	githubRetryBackoffs = backoffs
	t.Cleanup(func() {
		githubRetryBackoffs = previousBackoffs
	})
}

func createTarGz(t *testing.T, entryPath string, payload []byte) []byte {
	t.Helper()
	return createTarGzEntries(t, []tarEntry{{name: entryPath, mode: 0o755, payload: payload}})
}

type tarEntry struct {
	name      string
	mode      int64
	payload   []byte
	directory bool
}

func createTarGzEntries(t *testing.T, entries []tarEntry) []byte {
	t.Helper()
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)
	tarWriter := tar.NewWriter(gzipWriter)
	for _, entry := range entries {
		header := &tar.Header{
			Name: entry.name,
			Mode: entry.mode,
			Size: int64(len(entry.payload)),
		}
		if entry.directory {
			header.Typeflag = tar.TypeDir
			header.Size = 0
		}
		requireNoError(t, tarWriter.WriteHeader(header))
		if !entry.directory {
			_, err := tarWriter.Write(entry.payload)
			requireNoError(t, err)
		}
	}
	requireNoError(t, tarWriter.Close())
	requireNoError(t, gzipWriter.Close())
	return buffer.Bytes()
}

func sha256Hex(payload []byte) string {
	hash := sha256.Sum256(payload)
	return hex.EncodeToString(hash[:])
}

func stringPointer(value string) *string {
	return &value
}

func containsString(value string, substring string) bool {
	return bytes.Contains([]byte(value), []byte(substring))
}

func runCommand(t *testing.T, cwd string, args ...string) {
	t.Helper()
	failure := command.RunWithDetails(command.Spec{Args: args, CWD: &cwd})
	if failure != nil {
		t.Fatalf("command %v failed: %s", args, failure.Message)
	}
}

func commandOutput(t *testing.T, cwd string, args ...string) string {
	t.Helper()
	child := exec.Command(args[0], args[1:]...)
	child.Dir = cwd
	output, err := child.Output()
	if err != nil {
		t.Fatalf("command %v failed: %v", args, err)
	}
	return string(output)
}

type recordingRuntimePlanApplyObserver struct {
	events []string
}

type recordingOutputSink struct {
	stdout string
	stderr string
}

func (sink *recordingOutputSink) RecordOutput(stream command.OutputStream, bytes []byte) {
	switch stream {
	case command.OutputStreamStdout:
		sink.stdout += string(bytes)
	case command.OutputStreamStderr:
		sink.stderr += string(bytes)
	}
}

func (observer *recordingRuntimePlanApplyObserver) RecordStepStarted(step RuntimePlanApplyLifecycleStep) {
	observer.events = append(observer.events, "start:"+string(step))
}

func (observer *recordingRuntimePlanApplyObserver) RecordStepCompleted(step RuntimePlanApplyLifecycleStep) {
	observer.events = append(observer.events, "complete:"+string(step))
}

func createGitRepository(t *testing.T, path string) {
	t.Helper()
	requireNoError(t, os.MkdirAll(path, 0o755))
	runCommand(t, path, "git", "init")
	runCommand(t, path, "git", "config", "user.name", "Runtime Test")
	runCommand(t, path, "git", "config", "user.email", "runtime-test@example.test")
}

func gitCommitAll(t *testing.T, path string, message string) {
	t.Helper()
	runCommand(t, path, "git", "add", ".")
	runCommand(t, path, "git", "commit", "-m", message)
}

func assertStringSlicesEqual(t *testing.T, actual []string, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
	for index, expectedValue := range expected {
		if actual[index] != expectedValue {
			t.Fatalf("expected %v, got %v", expected, actual)
		}
	}
}
