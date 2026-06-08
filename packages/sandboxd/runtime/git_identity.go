package runtime

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/mistle/sandboxd/protocol"
)

func ApplyGitIdentity(sessionInput protocol.SessionRuntimeInput, globalConfigPath string) error {
	if err := ensureGlobalGitConfigParentExists(globalConfigPath); err != nil {
		return err
	}
	if sessionInput.GitIdentity == nil {
		if err := unsetGlobalGitConfig(globalConfigPath, "user.name"); err != nil {
			return err
		}
		if err := unsetGlobalGitConfig(globalConfigPath, "user.email"); err != nil {
			return err
		}
	} else {
		if err := applyGlobalGitConfig(globalConfigPath, "user.name", sessionInput.GitIdentity.Name); err != nil {
			return err
		}
		if err := applyGlobalGitConfig(globalConfigPath, "user.email", sessionInput.GitIdentity.Email); err != nil {
			return err
		}
	}
	signing := (*protocol.GitSigningConfig)(nil)
	if sessionInput.GitIdentity != nil {
		signing = sessionInput.GitIdentity.Signing
	}
	if signing == nil {
		if err := unsetGlobalGitConfig(globalConfigPath, "gpg.format"); err != nil {
			return err
		}
		if err := unsetGlobalGitConfig(globalConfigPath, "gpg.ssh.program"); err != nil {
			return err
		}
		if err := unsetGlobalGitConfig(globalConfigPath, "user.signingkey"); err != nil {
			return err
		}
		return nil
	}
	if err := applyGlobalGitConfig(globalConfigPath, "gpg.format", signing.Format); err != nil {
		return err
	}
	if err := applyGlobalGitConfig(globalConfigPath, "gpg.ssh.program", signing.Program); err != nil {
		return err
	}
	return applyGlobalGitConfig(globalConfigPath, "user.signingkey", signing.KeyRef)
}

func ensureGlobalGitConfigParentExists(globalConfigPath string) error {
	if globalConfigPath == "" {
		return fmt.Errorf("global git config path is required")
	}
	parent := filepath.Dir(globalConfigPath)
	if parent == "." || parent == "" {
		return fmt.Errorf("global git config path %s must include a parent directory", globalConfigPath)
	}
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return fmt.Errorf("failed to create global git config parent directory %s: %w", parent, err)
	}
	return nil
}

func applyGlobalGitConfig(globalConfigPath string, key string, value string) error {
	if err := ensureGlobalGitConfigParentExists(globalConfigPath); err != nil {
		return err
	}
	output, err := gitConfigCommand(globalConfigPath, "config", "--global", key, value).CombinedOutput()
	if err == nil {
		return nil
	}
	return fmt.Errorf("git config for %s failed: %w (output=%s)", key, err, string(output))
}

func unsetGlobalGitConfig(globalConfigPath string, key string) error {
	if err := ensureGlobalGitConfigParentExists(globalConfigPath); err != nil {
		return err
	}
	output, err := gitConfigCommand(globalConfigPath, "config", "--global", "--unset-all", key).CombinedOutput()
	if err == nil {
		return nil
	}
	if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 5 {
		return nil
	}
	return fmt.Errorf("git config --unset-all for %s failed: %w (output=%s)", key, err, string(output))
}

func gitConfigCommand(globalConfigPath string, args ...string) *exec.Cmd {
	command := exec.Command("git", args...)
	command.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL="+globalConfigPath)
	return command
}
