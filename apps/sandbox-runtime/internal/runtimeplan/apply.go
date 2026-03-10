package runtimeplan

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type ApplyInput struct {
	RuntimePlan           startup.RuntimePlan
	SandboxdEgressBaseURL string
}

const (
	runtimeImageSourceSnapshot    = "snapshot"
	runtimeImageSourceProfileBase = "profile-base"
	runtimeImageSourceBase        = "base"
)

type artifactLifecycleCommandSet string

const (
	artifactLifecycleCommandSetInstall artifactLifecycleCommandSet = "install"
	artifactLifecycleCommandSetUpdate  artifactLifecycleCommandSet = "update"
)

// Apply realizes the runtime plan on disk before runtime client processes are
// launched. It owns filesystem mutations only; networked workspace sources must
// go through sandboxd so later in-sandbox tool behavior matches startup
// behavior.
func Apply(input ApplyInput) error {
	commandSet, err := resolveArtifactLifecycleCommandSet(input.RuntimePlan.Image.Source)
	if err != nil {
		return err
	}
	if len(input.RuntimePlan.WorkspaceSources) > 0 {
		if strings.TrimSpace(input.SandboxdEgressBaseURL) == "" {
			return fmt.Errorf("sandboxd egress base url is required when workspaceSources are declared")
		}
	}

	if input.RuntimePlan.Image.Source == runtimeImageSourceSnapshot {
		for removalIndex, removal := range input.RuntimePlan.ArtifactRemovals {
			for commandIndex, command := range removal.Commands {
				if err := runRuntimeArtifactCommand(command); err != nil {
					return fmt.Errorf(
						"runtime plan artifactRemovals[%d] commands[%d] failed (artifactKey=%s): %w",
						removalIndex,
						commandIndex,
						removal.ArtifactKey,
						err,
					)
				}
			}
		}
	}

	for artifactIndex, artifact := range input.RuntimePlan.Artifacts {
		commands := selectArtifactLifecycleCommands(artifact, commandSet)
		for commandIndex, command := range commands {
			if err := runRuntimeArtifactCommand(command); err != nil {
				return fmt.Errorf(
					"runtime plan artifacts[%d] lifecycle.%s[%d] failed (artifactKey=%s): %w",
					artifactIndex,
					commandSet,
					commandIndex,
					artifact.ArtifactKey,
					err,
				)
			}
		}
	}

	for sourceIndex, workspaceSource := range input.RuntimePlan.WorkspaceSources {
		if err := applyWorkspaceSource(workspaceSource, input); err != nil {
			return fmt.Errorf(
				"runtime plan workspaceSources[%d] failed (sourceKind=%s path=%s): %w",
				sourceIndex,
				workspaceSource.SourceKind,
				workspaceSource.Path,
				err,
			)
		}
	}

	for clientIndex, runtimeClient := range input.RuntimePlan.RuntimeClients {
		for fileIndex, file := range runtimeClient.Setup.Files {
			if err := applyRuntimeFile(file); err != nil {
				return fmt.Errorf(
					"runtime plan runtimeClients[%d].setup.files[%d] failed (clientId=%s fileId=%s path=%s): %w",
					clientIndex,
					fileIndex,
					runtimeClient.ClientID,
					file.FileID,
					file.Path,
					err,
				)
			}
		}
	}

	return nil
}

func applyWorkspaceSource(workspaceSource startup.WorkspaceSource, input ApplyInput) error {
	switch workspaceSource.SourceKind {
	case "git-clone":
		return applyGitCloneWorkspaceSource(workspaceSource, input)
	default:
		return fmt.Errorf("workspace source kind '%s' is not supported", workspaceSource.SourceKind)
	}
}

// applyGitCloneWorkspaceSource performs the initial clone through sandboxd's
// route-based egress path, then restores the canonical origin URL and writes a
// repo-local insteadOf rule so later git commands continue to use mediated
// auth without storing credentials in the repository config.
func applyGitCloneWorkspaceSource(workspaceSource startup.WorkspaceSource, input ApplyInput) error {
	if pathExists(workspaceSource.Path) {
		return fmt.Errorf("workspace source path '%s' already exists", workspaceSource.Path)
	}

	parentDirectory := filepath.Dir(workspaceSource.Path)
	if err := os.MkdirAll(parentDirectory, 0o755); err != nil {
		return fmt.Errorf("failed to create parent directory %s: %w", parentDirectory, err)
	}

	sandboxRouteURL, err := createWorkspaceSourceRouteURL(
		input.SandboxdEgressBaseURL,
		workspaceSource.RouteID,
		workspaceSource.OriginURL,
	)
	if err != nil {
		return fmt.Errorf("failed to resolve sandbox route URL: %w", err)
	}

	if err := runGitCommand([]string{"clone", "--origin", "origin", sandboxRouteURL, workspaceSource.Path}); err != nil {
		return fmt.Errorf("failed to clone repository: %w", err)
	}

	if err := runGitCommand([]string{"-C", workspaceSource.Path, "remote", "set-url", "origin", workspaceSource.OriginURL}); err != nil {
		return fmt.Errorf("failed to restore canonical origin URL: %w", err)
	}

	if err := runGitCommand([]string{
		"-C",
		workspaceSource.Path,
		"config",
		"--local",
		"--replace-all",
		fmt.Sprintf("url.%s.insteadOf", sandboxRouteURL),
		workspaceSource.OriginURL,
	}); err != nil {
		return fmt.Errorf("failed to configure git url rewrite: %w", err)
	}

	return nil
}

// createWorkspaceSourceRouteURL maps a canonical origin URL onto the sandboxd
// route URL that tokenizer-proxy can authorize. The origin path is preserved so
// git still requests the expected repository endpoint after the route prefix is
// added.
func createWorkspaceSourceRouteURL(baseURL string, routeID string, originURL string) (string, error) {
	parsedBaseURL, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "", fmt.Errorf("failed to parse base URL: %w", err)
	}
	parsedOriginURL, err := url.Parse(strings.TrimSpace(originURL))
	if err != nil {
		return "", fmt.Errorf("failed to parse origin URL: %w", err)
	}
	if strings.TrimSpace(parsedOriginURL.Path) == "" {
		return "", fmt.Errorf("origin URL path is required")
	}

	routedURL := *parsedBaseURL
	routedURL.Path = joinURLPath(routedURL.Path, "routes/"+url.PathEscape(routeID))
	routedURL.Path = joinURLPath(routedURL.Path, parsedOriginURL.Path)
	routedURL.RawQuery = ""
	routedURL.Fragment = ""

	return routedURL.String(), nil
}

func joinURLPath(basePath string, suffixPath string) string {
	normalizedBasePath := strings.TrimSuffix(basePath, "/")
	normalizedSuffixPath := strings.TrimPrefix(suffixPath, "/")

	if normalizedBasePath == "" || normalizedBasePath == "/" {
		if normalizedSuffixPath == "" {
			return "/"
		}

		return "/" + normalizedSuffixPath
	}

	if normalizedSuffixPath == "" {
		return normalizedBasePath
	}

	return normalizedBasePath + "/" + normalizedSuffixPath
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func runGitCommand(args []string) error {
	commandArgs := append([]string{"git"}, args...)

	return runRuntimeArtifactCommand(startup.RuntimeArtifactCommand{
		Args: commandArgs,
		Env: map[string]string{
			"GIT_TERMINAL_PROMPT": "0",
		},
	})
}

func resolveArtifactLifecycleCommandSet(source string) (artifactLifecycleCommandSet, error) {
	switch source {
	case runtimeImageSourceSnapshot:
		return artifactLifecycleCommandSetUpdate, nil
	case runtimeImageSourceProfileBase, runtimeImageSourceBase:
		return artifactLifecycleCommandSetInstall, nil
	default:
		return "", fmt.Errorf("runtime plan image source '%s' is not supported", source)
	}
}

func selectArtifactLifecycleCommands(
	artifact startup.RuntimeArtifactSpec,
	commandSet artifactLifecycleCommandSet,
) []startup.RuntimeArtifactCommand {
	if commandSet == artifactLifecycleCommandSetUpdate {
		return artifact.Lifecycle.Update
	}

	return artifact.Lifecycle.Install
}

func runRuntimeArtifactCommand(command startup.RuntimeArtifactCommand) error {
	if len(command.Args) == 0 {
		return fmt.Errorf("artifact command args must not be empty")
	}

	commandContext := context.Background()
	cancel := func() {}
	if command.TimeoutMs > 0 {
		commandContext, cancel = context.WithTimeout(commandContext, time.Duration(command.TimeoutMs)*time.Millisecond)
	}
	defer cancel()

	execCommand := exec.CommandContext(commandContext, command.Args[0], command.Args[1:]...)
	if strings.TrimSpace(command.Cwd) != "" {
		execCommand.Dir = command.Cwd
	}
	if len(command.Env) > 0 {
		execCommand.Env = mergedCommandEnvironment(command.Env)
	}

	commandOutput, err := execCommand.CombinedOutput()
	if err == nil {
		return nil
	}

	if errors.Is(commandContext.Err(), context.DeadlineExceeded) {
		return fmt.Errorf("artifact command timed out after %dms", command.TimeoutMs)
	}

	outputText := strings.TrimSpace(string(commandOutput))
	if outputText == "" {
		return fmt.Errorf("artifact command failed: %w", err)
	}

	return fmt.Errorf("artifact command failed: %w (output=%s)", err, outputText)
}

func mergedCommandEnvironment(overrides map[string]string) []string {
	environmentByKey := make(map[string]string)
	for _, entry := range os.Environ() {
		key, value, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		environmentByKey[key] = value
	}

	for key, value := range overrides {
		environmentByKey[key] = value
	}

	keys := make([]string, 0, len(environmentByKey))
	for key := range environmentByKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	merged := make([]string, 0, len(keys))
	for _, key := range keys {
		merged = append(merged, fmt.Sprintf("%s=%s", key, environmentByKey[key]))
	}

	return merged
}

func applyRuntimeFile(file startup.RuntimeFileSpec) error {
	parentDirectory := filepath.Dir(file.Path)
	if err := os.MkdirAll(parentDirectory, 0o755); err != nil {
		return fmt.Errorf("failed to create parent directory %s: %w", parentDirectory, err)
	}

	if err := os.WriteFile(file.Path, []byte(file.Content), os.FileMode(file.Mode)); err != nil {
		return fmt.Errorf("failed to write file %s: %w", file.Path, err)
	}

	return nil
}
