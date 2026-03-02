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
				RuntimeClientSetups: []startup.RuntimeClientSetup{
					{
						ClientID: "client_codex",
						Env:      map[string]string{},
						Files: []startup.RuntimeFileSpec{
							{
								FileID:  "file_codex_config",
								Path:    firstFilePath,
								Mode:    0o600,
								Content: "api_base_url = \"http://127.0.0.1:8090/egress/routes/route_openai\"",
							},
						},
					},
					{
						ClientID: "client_github",
						Env:      map[string]string{},
						Files: []startup.RuntimeFileSpec{
							{
								FileID:  "file_github_config",
								Path:    secondFilePath,
								Mode:    0o644,
								Content: "{\"base_url\":\"https://api.github.com\"}",
							},
						},
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
		if string(firstFileBytes) != "api_base_url = \"http://127.0.0.1:8090/egress/routes/route_openai\"" {
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

	t.Run("returns an error when a parent directory cannot be created", func(t *testing.T) {
		tempDirectory := t.TempDir()
		blockingPath := filepath.Join(tempDirectory, "not-a-directory")
		if err := os.WriteFile(blockingPath, []byte("blocking-file"), 0o600); err != nil {
			t.Fatalf("expected blocking file creation to succeed, got %v", err)
		}

		err := Apply(ApplyInput{
			RuntimePlan: startup.RuntimePlan{
				RuntimeClientSetups: []startup.RuntimeClientSetup{
					{
						ClientID: "client_failure",
						Env:      map[string]string{},
						Files: []startup.RuntimeFileSpec{
							{
								FileID:  "file_failure",
								Path:    filepath.Join(blockingPath, "config.toml"),
								Mode:    0o600,
								Content: "value = \"x\"",
							},
						},
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
}
