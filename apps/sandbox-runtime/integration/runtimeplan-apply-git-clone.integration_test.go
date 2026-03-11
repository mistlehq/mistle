package integration

import (
	"fmt"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/runtimeplan"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type startedGitBackendServer struct {
	baseURL string
	close   func()
}

func TestRuntimePlanApplyGitClone(t *testing.T) {
	isolateGitEnvironment(t)

	repoFixture := seedBareGitRepository(t)
	gitBackendServer := startGitBackendServer(t, repoFixture.repoRoot)
	defer gitBackendServer.close()

	clonePath := filepath.Join(t.TempDir(), "workspace", "repos", "mistlehq", "mistle")
	canonicalOriginURL := gitBackendServer.baseURL + "/mistlehq/mistle.git"

	err := runtimeplan.Apply(runtimeplan.ApplyInput{
		RuntimePlan: startup.RuntimePlan{
			SandboxProfileID: "sbp_123",
			Version:          1,
			Image: startup.ResolvedSandboxImage{
				Source:   "base",
				ImageRef: "mistle/sandbox-base:dev",
			},
			WorkspaceSources: []startup.WorkspaceSource{
				{
					SourceKind:   "git-clone",
					ResourceKind: "repository",
					Path:         clonePath,
					OriginURL:    canonicalOriginURL,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("expected runtime plan apply to succeed, got %v", err)
	}

	readmeBytes, err := os.ReadFile(filepath.Join(clonePath, "README.md"))
	if err != nil {
		t.Fatalf("expected cloned repository README to exist, got %v", err)
	}
	if string(readmeBytes) != "hello from main\n" {
		t.Fatalf("unexpected cloned repository README contents: %q", string(readmeBytes))
	}

	remoteOriginURL := strings.TrimSpace(runGit(t, clonePath, "config", "--local", "--get", "remote.origin.url"))
	if remoteOriginURL != canonicalOriginURL {
		t.Fatalf("expected canonical origin URL %s, got %s", canonicalOriginURL, remoteOriginURL)
	}

	nextCommitID := appendCommitAndPush(t, repoFixture.workTreeRoot, "next line\n")

	runGit(t, clonePath, "fetch", "origin")

	remoteHeadCommitID := strings.TrimSpace(runGit(t, clonePath, "rev-parse", "refs/remotes/origin/main"))
	if remoteHeadCommitID != nextCommitID {
		t.Fatalf("expected fetched origin/main commit %s, got %s", nextCommitID, remoteHeadCommitID)
	}
}

type seededGitRepository struct {
	repoRoot     string
	workTreeRoot string
	bareRepoPath string
}

func seedBareGitRepository(t *testing.T) seededGitRepository {
	t.Helper()

	root := t.TempDir()
	workTreeRoot := filepath.Join(root, "work")
	bareRepoPath := filepath.Join(root, "repos", "mistlehq", "mistle.git")

	if err := os.MkdirAll(filepath.Dir(bareRepoPath), 0o755); err != nil {
		t.Fatalf("expected bare repository parent directory creation to succeed, got %v", err)
	}

	runGit(t, "", "init", workTreeRoot)
	runGit(t, workTreeRoot, "config", "user.name", "Mistle Test")
	runGit(t, workTreeRoot, "config", "user.email", "test@example.com")

	if err := os.WriteFile(filepath.Join(workTreeRoot, "README.md"), []byte("hello from main\n"), 0o644); err != nil {
		t.Fatalf("expected work tree README write to succeed, got %v", err)
	}

	runGit(t, workTreeRoot, "add", "README.md")
	runGit(t, workTreeRoot, "commit", "-m", "initial")
	runGit(t, workTreeRoot, "branch", "-M", "main")

	runGit(t, "", "init", "--bare", bareRepoPath)
	runGit(t, workTreeRoot, "remote", "add", "origin", bareRepoPath)
	runGit(t, workTreeRoot, "push", "origin", "HEAD:refs/heads/main")
	runGit(t, "", "--git-dir", bareRepoPath, "symbolic-ref", "HEAD", "refs/heads/main")

	return seededGitRepository{
		repoRoot:     filepath.Join(root, "repos"),
		workTreeRoot: workTreeRoot,
		bareRepoPath: bareRepoPath,
	}
}

func appendCommitAndPush(t *testing.T, workTreeRoot string, appendedLine string) string {
	t.Helper()

	readmePath := filepath.Join(workTreeRoot, "README.md")
	file, err := os.OpenFile(readmePath, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatalf("expected README append open to succeed, got %v", err)
	}
	if _, err := file.WriteString(appendedLine); err != nil {
		_ = file.Close()
		t.Fatalf("expected README append write to succeed, got %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("expected README append close to succeed, got %v", err)
	}

	runGit(t, workTreeRoot, "add", "README.md")
	runGit(t, workTreeRoot, "commit", "-m", "update")
	runGit(t, workTreeRoot, "push", "origin", "HEAD:refs/heads/main")

	return strings.TrimSpace(runGit(t, workTreeRoot, "rev-parse", "HEAD"))
}

func startGitBackendServer(t *testing.T, repoRoot string) *startedGitBackendServer {
	t.Helper()

	gitBinaryPath, err := exec.LookPath("git")
	if err != nil {
		t.Fatalf("expected git binary to be available, got %v", err)
	}

	server := &startedGitBackendServer{}
	gitHTTPHandler := func(root string) http.Handler {
		cgiHandler := &cgi.Handler{
			Path: gitBinaryPath,
			Args: []string{"http-backend"},
			Root: root,
			Env: []string{
				fmt.Sprintf("GIT_PROJECT_ROOT=%s", repoRoot),
				"GIT_HTTP_EXPORT_ALL=1",
			},
		}

		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			cgiHandler.ServeHTTP(writer, request)
		})
	}

	mux := http.NewServeMux()
	mux.Handle("/", gitHTTPHandler(""))

	httpServer := httptest.NewServer(mux)
	server.baseURL = httpServer.URL
	server.close = httpServer.Close

	return server
}

func isolateGitEnvironment(t *testing.T) {
	t.Helper()

	homeDirectory := t.TempDir()
	globalConfigPath := filepath.Join(homeDirectory, ".gitconfig")
	if err := os.WriteFile(globalConfigPath, []byte{}, 0o600); err != nil {
		t.Fatalf("expected git global config file creation to succeed, got %v", err)
	}

	t.Setenv("HOME", homeDirectory)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(homeDirectory, ".config"))
	t.Setenv("GIT_CONFIG_GLOBAL", globalConfigPath)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
}

func runGit(t *testing.T, cwd string, args ...string) string {
	t.Helper()

	command := exec.Command("git", args...)
	if strings.TrimSpace(cwd) != "" {
		command.Dir = cwd
	}
	command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")

	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("expected git %s to succeed, got %v (output=%s)", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}

	return string(output)
}
