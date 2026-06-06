package sandboxdstate

import (
	"os"
	"strings"

	"github.com/mistle/sandboxd/command"
	"github.com/mistle/sandboxd/runtime"
)

const (
	SetupScriptWorkingDirectory = "/root"
	SetupScriptFileMode         = 0o700
	DefaultPTYShell             = "/bin/bash"
	DefaultPTYTerm              = "xterm-256color"
)

func RunSetupScript(runtimePlan runtime.CompiledRuntimePlan, runtimeEnv map[string]string) *command.Failure {
	return RunSetupScriptInDirectory(runtimePlan, runtimeEnv, SetupScriptWorkingDirectory)
}

func RunSetupScriptInDirectory(runtimePlan runtime.CompiledRuntimePlan, runtimeEnv map[string]string, workingDirectory string) *command.Failure {
	setupScript := runtimePlan.SetupScript
	if setupScript == nil || strings.TrimSpace(*setupScript) == "" {
		return nil
	}

	setupScriptFile, err := os.CreateTemp("", "mistle-setup-script-*.sh")
	if err != nil {
		return setupScriptFileFailure("failed to create temporary file: " + err.Error())
	}
	setupScriptPath := setupScriptFile.Name()
	cleanup := func() *command.Failure {
		if err := os.Remove(setupScriptPath); err != nil {
			return setupScriptFileFailure("failed to remove temporary script file: " + err.Error())
		}
		return nil
	}

	if _, err := setupScriptFile.WriteString(*setupScript); err != nil {
		setupScriptFile.Close()
		cleanupFailure := cleanup()
		if cleanupFailure != nil {
			return cleanupFailure
		}
		return setupScriptFileFailure("failed to write temporary script file: " + err.Error())
	}
	if err := setupScriptFile.Close(); err != nil {
		cleanupFailure := cleanup()
		if cleanupFailure != nil {
			return cleanupFailure
		}
		return setupScriptFileFailure("failed to flush temporary script file: " + err.Error())
	}
	if err := os.Chmod(setupScriptPath, SetupScriptFileMode); err != nil {
		cleanupFailure := cleanup()
		if cleanupFailure != nil {
			return cleanupFailure
		}
		return setupScriptFileFailure("failed to make temporary script executable: " + err.Error())
	}

	environment := BuildSetupScriptEnvironment(runtimeEnv)
	runFailure := command.RunWithDetails(command.Spec{
		Args: buildSetupScriptCommandArgs(*setupScript, setupScriptPath),
		Env:  environment,
		CWD:  &workingDirectory,
	})
	cleanupFailure := cleanup()
	if cleanupFailure != nil {
		return cleanupFailure
	}
	return runFailure
}

func BuildSetupScriptEnvironment(runtimeEnv map[string]string) map[string]string {
	environment := make(map[string]string)
	for _, entry := range os.Environ() {
		name, value, ok := strings.Cut(entry, "=")
		if ok {
			environment[name] = value
		}
	}
	environment["TERM"] = DefaultPTYTerm
	for name, value := range runtimeEnv {
		environment[name] = value
	}
	return environment
}

func buildSetupScriptCommandArgs(setupScript string, setupScriptPath string) []string {
	if strings.HasPrefix(setupScript, "#!") {
		return []string{setupScriptPath}
	}
	return []string{DefaultPTYShell, "-l", setupScriptPath}
}

func setupScriptFileFailure(message string) *command.Failure {
	return &command.Failure{Message: message}
}
