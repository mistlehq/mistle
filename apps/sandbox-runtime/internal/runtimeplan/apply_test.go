package runtimeplan

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

func TestApply(t *testing.T) {
	t.Run("writes runtime client setup files with declared content and modes", func(t *testing.T) {
		tempDirectory := t.TempDir()
		firstFilePath := filepath.Join(tempDirectory, "codex", "config.toml")
		secondFilePath := filepath.Join(tempDirectory, "github", "config.json")

		err := Apply(ApplyInput{
			RuntimePlan: startup.RuntimePlan{
				Image: startup.ResolvedSandboxImage{
					Source:   "base",
					ImageRef: "mistle/sandbox-base:dev",
				},
				RuntimeClients: []startup.RuntimeClient{
					{
						ClientID: "client_codex",
						Setup: startup.RuntimeClientSetup{
							Env: map[string]string{},
							Files: []startup.RuntimeFileSpec{
								{
									FileID:  "file_codex_config",
									Path:    firstFilePath,
									Mode:    0o600,
									Content: "api_base_url = \"https://api.openai.com/v1\"",
								},
							},
						},
						Processes: []startup.RuntimeClientProcessSpec{},
						Endpoints: []startup.RuntimeClientEndpointSpec{},
					},
					{
						ClientID: "client_github",
						Setup: startup.RuntimeClientSetup{
							Env: map[string]string{},
							Files: []startup.RuntimeFileSpec{
								{
									FileID:  "file_github_config",
									Path:    secondFilePath,
									Mode:    0o644,
									Content: "{\"base_url\":\"https://api.github.com\"}",
								},
							},
						},
						Processes: []startup.RuntimeClientProcessSpec{},
						Endpoints: []startup.RuntimeClientEndpointSpec{},
					},
				},
			},
		})
		if err != nil {
			t.Fatalf("expected runtime plan apply to succeed, got %v", err)
		}

		firstFileBytes, err := os.ReadFile(firstFilePath)
		if err != nil {
			t.Fatalf("expected first runtime file to exist, got %v", err)
		}
		if string(firstFileBytes) != "api_base_url = \"https://api.openai.com/v1\"" {
			t.Fatalf("unexpected first runtime file content: %s", string(firstFileBytes))
		}

		secondFileBytes, err := os.ReadFile(secondFilePath)
		if err != nil {
			t.Fatalf("expected second runtime file to exist, got %v", err)
		}
		if string(secondFileBytes) != "{\"base_url\":\"https://api.github.com\"}" {
			t.Fatalf("unexpected second runtime file content: %s", string(secondFileBytes))
		}

		firstFileInfo, err := os.Stat(firstFilePath)
		if err != nil {
			t.Fatalf("expected first runtime file stat to succeed, got %v", err)
		}
		if firstFileInfo.Mode().Perm() != 0o600 {
			t.Fatalf("expected first runtime file mode 0600, got %o", firstFileInfo.Mode().Perm())
		}

		secondFileInfo, err := os.Stat(secondFilePath)
		if err != nil {
			t.Fatalf("expected second runtime file stat to succeed, got %v", err)
		}
		if secondFileInfo.Mode().Perm() != 0o644 {
			t.Fatalf("expected second runtime file mode 0644, got %o", secondFileInfo.Mode().Perm())
		}
	})

	t.Run("skips create-only runtime files when the target already exists", func(t *testing.T) {
		tempDirectory := t.TempDir()
		configPath := filepath.Join(tempDirectory, "codex", "config.toml")
		if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
			t.Fatalf("expected config directory creation to succeed, got %v", err)
		}
		if err := os.WriteFile(configPath, []byte("model = \"user-choice\""), 0o600); err != nil {
			t.Fatalf("expected existing config write to succeed, got %v", err)
		}

		err := Apply(ApplyInput{
			RuntimePlan: startup.RuntimePlan{
				Image: startup.ResolvedSandboxImage{
					Source:   "base",
					ImageRef: "mistle/sandbox-base:dev",
				},
				RuntimeClients: []startup.RuntimeClient{
					{
						ClientID: "client_codex",
						Setup: startup.RuntimeClientSetup{
							Env: map[string]string{},
							Files: []startup.RuntimeFileSpec{
								{
									FileID:    "file_codex_config",
									Path:      configPath,
									Mode:      0o600,
									Content:   "model = \"seeded-default\"",
									WriteMode: "if-absent",
								},
							},
						},
						Processes: []startup.RuntimeClientProcessSpec{},
						Endpoints: []startup.RuntimeClientEndpointSpec{},
					},
				},
			},
		})
		if err != nil {
			t.Fatalf("expected create-only runtime file apply to succeed, got %v", err)
		}

		fileBytes, err := os.ReadFile(configPath)
		if err != nil {
			t.Fatalf("expected config file read to succeed, got %v", err)
		}
		if string(fileBytes) != "model = \"user-choice\"" {
			t.Fatalf("expected existing config to be preserved, got %s", string(fileBytes))
		}
	})

	t.Run("returns an error when a parent directory cannot be created", func(t *testing.T) {
		tempDirectory := t.TempDir()
		blockingPath := filepath.Join(tempDirectory, "not-a-directory")
		if err := os.WriteFile(blockingPath, []byte("blocking-file"), 0o600); err != nil {
			t.Fatalf("expected blocking file creation to succeed, got %v", err)
		}

		err := Apply(ApplyInput{
			RuntimePlan: startup.RuntimePlan{
				Image: startup.ResolvedSandboxImage{
					Source:   "base",
					ImageRef: "mistle/sandbox-base:dev",
				},
				RuntimeClients: []startup.RuntimeClient{
					{
						ClientID: "client_failure",
						Setup: startup.RuntimeClientSetup{
							Env: map[string]string{},
							Files: []startup.RuntimeFileSpec{
								{
									FileID:  "file_failure",
									Path:    filepath.Join(blockingPath, "config.toml"),
									Mode:    0o600,
									Content: "value = \"x\"",
								},
							},
						},
						Processes: []startup.RuntimeClientProcessSpec{},
						Endpoints: []startup.RuntimeClientEndpointSpec{},
					},
				},
			},
		})
		if err == nil {
			t.Fatal("expected runtime plan apply to fail when parent directory is blocked by a file")
		}
		if !strings.Contains(err.Error(), "failed to create parent directory") {
			t.Fatalf("expected parent directory failure in error, got %v", err)
		}
	})

	t.Run("runs install commands for base sources before applying runtime files", func(t *testing.T) {
		tempDirectory := t.TempDir()
		artifactMarkerPath := filepath.Join(tempDirectory, "artifact-marker.txt")
		sharedPath := filepath.Join(tempDirectory, "shared.txt")

		err := Apply(ApplyInput{
			RuntimePlan: startup.RuntimePlan{
				Image: startup.ResolvedSandboxImage{
					Source:   "base",
					ImageRef: "mistle/sandbox-base:dev",
				},
				Artifacts: []startup.RuntimeArtifactSpec{
					{
						ArtifactKey: "artifact_cli",
						Name:        "Artifact CLI",
						Lifecycle: startup.RuntimeArtifactLifecycle{
							Install: []startup.RuntimeArtifactCommand{
								{
									Args: []string{
										"sh",
										"-euc",
										`printf '%s' "$MARKER_CONTENT" > "$MARKER_PATH"; printf '%s' "$SHARED_CONTENT" > "$SHARED_PATH"`,
									},
									Env: map[string]string{
										"MARKER_PATH":    artifactMarkerPath,
										"MARKER_CONTENT": "artifact-install",
										"SHARED_PATH":    sharedPath,
										"SHARED_CONTENT": "artifact-content",
									},
								},
							},
						},
					},
				},
				RuntimeClients: []startup.RuntimeClient{
					{
						ClientID: "client_codex",
						Setup: startup.RuntimeClientSetup{
							Env: map[string]string{},
							Files: []startup.RuntimeFileSpec{
								{
									FileID:  "file_shared",
									Path:    sharedPath,
									Mode:    0o600,
									Content: "runtime-file-content",
								},
							},
						},
						Processes: []startup.RuntimeClientProcessSpec{},
						Endpoints: []startup.RuntimeClientEndpointSpec{},
					},
				},
			},
		})
		if err != nil {
			t.Fatalf("expected runtime plan apply to succeed, got %v", err)
		}

		artifactMarkerBytes, err := os.ReadFile(artifactMarkerPath)
		if err != nil {
			t.Fatalf("expected artifact marker file to exist, got %v", err)
		}
		if string(artifactMarkerBytes) != "artifact-install" {
			t.Fatalf("unexpected artifact marker content: %s", string(artifactMarkerBytes))
		}

		sharedBytes, err := os.ReadFile(sharedPath)
		if err != nil {
			t.Fatalf("expected shared file to exist, got %v", err)
		}
		if string(sharedBytes) != "runtime-file-content" {
			t.Fatalf("expected runtime file to overwrite shared path, got %s", string(sharedBytes))
		}
	})

	t.Run("runs install commands for profile-base sources and skips update commands", func(t *testing.T) {
		tempDirectory := t.TempDir()
		installMarkerPath := filepath.Join(tempDirectory, "install-marker.txt")

		err := Apply(ApplyInput{
			RuntimePlan: startup.RuntimePlan{
				Image: startup.ResolvedSandboxImage{
					Source:           "profile-base",
					ImageRef:         "mistle/sandbox-profile-base@sha256:test",
					SandboxProfileID: "sbp_test",
					Version:          3,
				},
				Artifacts: []startup.RuntimeArtifactSpec{
					{
						ArtifactKey: "artifact_cli",
						Name:        "Artifact CLI",
						Lifecycle: startup.RuntimeArtifactLifecycle{
							Install: []startup.RuntimeArtifactCommand{
								{
									Args: []string{
										"sh",
										"-euc",
										`printf '%s' "$INSTALL_CONTENT" > "$INSTALL_PATH"`,
									},
									Env: map[string]string{
										"INSTALL_PATH":    installMarkerPath,
										"INSTALL_CONTENT": "artifact-install",
									},
								},
							},
							Update: []startup.RuntimeArtifactCommand{
								{
									Args: []string{"sh", "-euc", "exit 91"},
								},
							},
						},
					},
				},
				RuntimeClients: []startup.RuntimeClient{},
			},
		})
		if err != nil {
			t.Fatalf("expected profile-base artifact install command to succeed, got %v", err)
		}

		installMarkerBytes, err := os.ReadFile(installMarkerPath)
		if err != nil {
			t.Fatalf("expected install marker file to exist, got %v", err)
		}
		if string(installMarkerBytes) != "artifact-install" {
			t.Fatalf("unexpected install marker content: %s", string(installMarkerBytes))
		}
	})

	t.Run("returns explicit error when an artifact command fails", func(t *testing.T) {
		err := Apply(ApplyInput{
			RuntimePlan: startup.RuntimePlan{
				Image: startup.ResolvedSandboxImage{
					Source:   "base",
					ImageRef: "mistle/sandbox-base:dev",
				},
				Artifacts: []startup.RuntimeArtifactSpec{
					{
						ArtifactKey: "artifact_cli",
						Name:        "Artifact CLI",
						Lifecycle: startup.RuntimeArtifactLifecycle{
							Install: []startup.RuntimeArtifactCommand{
								{
									Args: []string{"sh", "-euc", "exit 7"},
								},
							},
						},
					},
				},
				RuntimeClients: []startup.RuntimeClient{},
			},
		})
		if err == nil {
			t.Fatal("expected artifact command failure")
		}
		if !strings.Contains(err.Error(), "runtime plan artifacts[0] lifecycle.install[0] failed") {
			t.Fatalf("expected artifact lifecycle location in error, got %v", err)
		}
		if !strings.Contains(err.Error(), "artifactKey=artifact_cli") {
			t.Fatalf("expected artifact key in error, got %v", err)
		}
	})

	t.Run("returns explicit error when an artifact command times out", func(t *testing.T) {
		err := Apply(ApplyInput{
			RuntimePlan: startup.RuntimePlan{
				Image: startup.ResolvedSandboxImage{
					Source:   "base",
					ImageRef: "mistle/sandbox-base:dev",
				},
				Artifacts: []startup.RuntimeArtifactSpec{
					{
						ArtifactKey: "artifact_cli",
						Name:        "Artifact CLI",
						Lifecycle: startup.RuntimeArtifactLifecycle{
							Install: []startup.RuntimeArtifactCommand{
								{
									Args:      []string{"sh", "-euc", "sleep 1"},
									TimeoutMs: 10,
								},
							},
						},
					},
				},
				RuntimeClients: []startup.RuntimeClient{},
			},
		})
		if err == nil {
			t.Fatal("expected artifact command timeout failure")
		}
		if !strings.Contains(err.Error(), "artifact command timed out after 10ms") {
			t.Fatalf("expected timeout details in error, got %v", err)
		}
	})
}
