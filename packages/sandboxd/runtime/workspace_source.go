package runtime

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mistle/sandboxd/command"
)

const (
	egressGrantHeaderName = "X-Mistle-Egress-Grant"
	gitCloneAttempts      = 3
)

var gitCloneRetryBackoffs = []time.Duration{time.Second, 2 * time.Second}

func ApplyWorkspaceSource(workspaceSource CompiledWorkspaceSource, managedEnv map[string]string) error {
	return ApplyWorkspaceSourceWithOutputSink(workspaceSource, managedEnv, nil)
}

func ApplyWorkspaceSourceWithOutputSink(workspaceSource CompiledWorkspaceSource, managedEnv map[string]string, outputSink command.OutputSink) error {
	if workspaceSource.SourceKind != WorkspaceSourceKindGitClone {
		return fmt.Errorf("unsupported workspace source kind %s", workspaceSource.SourceKind)
	}
	if workspaceSource.ResourceKind != WorkspaceSourceResourceKindRepository {
		return fmt.Errorf("unsupported workspace source resource kind %s", workspaceSource.ResourceKind)
	}
	return applyGitCloneWorkspaceSource(workspaceSource, managedEnv, outputSink)
}

func applyGitCloneWorkspaceSource(workspaceSource CompiledWorkspaceSource, managedEnv map[string]string, outputSink command.OutputSink) error {
	if _, err := os.Stat(workspaceSource.Path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("failed to inspect workspace source path %s: %w", workspaceSource.Path, err)
	}

	parentDirectory := filepath.Dir(workspaceSource.Path)
	if parentDirectory == "." || parentDirectory == workspaceSource.Path {
		return fmt.Errorf("workspace source path %s has no parent directory", workspaceSource.Path)
	}
	if err := os.MkdirAll(parentDirectory, 0o755); err != nil {
		return fmt.Errorf("failed to create parent directory %s: %w", parentDirectory, err)
	}

	env, err := buildGitCommandEnvironment(managedEnv)
	if err != nil {
		return err
	}
	args := []string{"git"}
	if workspaceSource.EgressGrantToken != nil {
		args = append(args, "-c", "http.extraHeader="+egressGrantHeaderName+": "+*workspaceSource.EgressGrantToken)
	}
	cloneURL := workspaceSource.OriginURL
	if workspaceSource.CloneURL != nil {
		cloneURL = *workspaceSource.CloneURL
	}
	args = append(args, "clone", "--origin", "origin", cloneURL, workspaceSource.Path)

	if err := runGitCloneCommandWithRetry(command.Spec{Args: args, Env: env}, outputSink); err != nil {
		return err
	}

	if workspaceSource.CloneURL != nil && *workspaceSource.CloneURL != workspaceSource.OriginURL {
		failure := command.RunWithDetailsAndOutputSink(command.Spec{
			Args: []string{
				"git",
				"-C",
				workspaceSource.Path,
				"remote",
				"set-url",
				"origin",
				workspaceSource.OriginURL,
			},
			Env: env,
		}, outputSink)
		if failure != nil {
			return fmt.Errorf("failed to restore repository origin url: %s", failure.Message)
		}
	}

	return nil
}

func runGitCloneCommandWithRetry(spec command.Spec, outputSink command.OutputSink) error {
	for attemptIndex := range gitCloneAttempts {
		failure := command.RunWithDetailsAndOutputSink(spec, outputSink)
		if failure == nil {
			return nil
		}

		attemptNumber := attemptIndex + 1
		attemptsRemaining := gitCloneAttempts - attemptNumber
		if attemptsRemaining == 0 || !isRetryableGitCloneFailure(failure) {
			return formatGitCloneFailure(failure, attemptNumber)
		}

		time.Sleep(gitCloneRetryBackoffs[attemptIndex])
	}

	return fmt.Errorf("failed to clone repository: git clone retry loop exhausted unexpectedly")
}

func formatGitCloneFailure(failure *command.Failure, attemptCount int) error {
	if attemptCount <= 1 {
		return fmt.Errorf("failed to clone repository: %s", failure.Message)
	}
	return fmt.Errorf("failed to clone repository after %d attempts: %s", attemptCount, failure.Message)
}

func isRetryableGitCloneFailure(failure *command.Failure) bool {
	if failure.TimedOut {
		return true
	}

	failureText := strings.ToLower(strings.Join(gitCloneFailureTextParts(failure), "\n"))
	return isRetryableGitHTTPFailure(failureText) || isRetryableGitNetworkFailure(failureText)
}

func gitCloneFailureTextParts(failure *command.Failure) []string {
	parts := []string{failure.Message}
	if failure.OutputTails.StdoutTail != nil {
		parts = append(parts, *failure.OutputTails.StdoutTail)
	}
	if failure.OutputTails.StderrTail != nil {
		parts = append(parts, *failure.OutputTails.StderrTail)
	}
	return parts
}

func isRetryableGitHTTPFailure(failureText string) bool {
	for _, needle := range []string{
		"returned error: 403",
		"returned error: 404",
		"returned error: 429",
		"returned error: 500",
		"returned error: 502",
		"returned error: 503",
		"returned error: 504",
		"http 403",
		"http 404",
		"http 429",
		"http 500",
		"http 502",
		"http 503",
		"http 504",
	} {
		if strings.Contains(failureText, needle) {
			return true
		}
	}
	return false
}

func isRetryableGitNetworkFailure(failureText string) bool {
	for _, needle := range []string{
		"could not resolve host",
		"couldn't connect to server",
		"failed to connect",
		"connection reset",
		"connection timed out",
		"early eof",
		"gnutls recv error",
		"network is unreachable",
		"operation timed out",
		"ssl connection timeout",
		"temporary failure in name resolution",
		"tls connection",
	} {
		if strings.Contains(failureText, needle) {
			return true
		}
	}
	return false
}

func buildGitCommandEnvironment(managedEnv map[string]string) (map[string]string, error) {
	env := make(map[string]string, len(managedEnv)+1)
	for key, value := range managedEnv {
		env[key] = value
	}
	if existingValue, ok := env["GIT_TERMINAL_PROMPT"]; ok {
		if existingValue != "0" {
			return nil, fmt.Errorf("managed runtime env defines 'GIT_TERMINAL_PROMPT', which workspace clone reserves")
		}
		return env, nil
	}
	env["GIT_TERMINAL_PROMPT"] = "0"
	return env, nil
}
