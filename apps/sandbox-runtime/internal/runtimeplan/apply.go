package runtimeplan

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type ApplyInput struct {
	RuntimePlan startup.RuntimePlan
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

func Apply(input ApplyInput) error {
	commandSet, err := resolveArtifactLifecycleCommandSet(input.RuntimePlan.Image.Source)
	if err != nil {
		return err
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
