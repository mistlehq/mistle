package command

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunWithDetailsSucceedsForZeroExitCommand(t *testing.T) {
	failure := RunWithDetails(Spec{Args: []string{"/bin/sh", "-c", "printf ok"}})

	if failure != nil {
		t.Fatalf("expected command to succeed, got %#v", failure)
	}
}

func TestRunWithDetailsReportsExitCodeAndCombinedOutput(t *testing.T) {
	failure := RunWithDetails(Spec{Args: []string{"/bin/sh", "-c", "printf stdout; printf stderr >&2; exit 7"}})

	if failure == nil {
		t.Fatalf("expected command to fail")
	}
	assertEqual(t, failure.Message, "command failed with exit code 7 (output=stdout\nstderr)")
	assertEqual(t, *failure.ExitCode, 7)
	assertEqual(t, failure.TimedOut, false)
	assertEqual(t, *failure.OutputTails.StdoutTail, "stdout")
	assertEqual(t, *failure.OutputTails.StderrTail, "stderr")
}

func TestRunWithDetailsReportsFailureWithoutOutput(t *testing.T) {
	failure := RunWithDetails(Spec{Args: []string{"/bin/sh", "-c", "exit 9"}})

	if failure == nil {
		t.Fatalf("expected command to fail")
	}
	assertEqual(t, failure.Message, "command failed with exit code 9")
	assertEqual(t, *failure.ExitCode, 9)
	if failure.OutputTails.StdoutTail != nil {
		t.Fatalf("expected stdout tail to be absent")
	}
	if failure.OutputTails.StderrTail != nil {
		t.Fatalf("expected stderr tail to be absent")
	}
}

func TestRunWithDetailsAppliesEnvironmentAndWorkingDirectory(t *testing.T) {
	tempDir := t.TempDir()
	outputPath := filepath.Join(tempDir, "command-output.txt")
	script := "printf '%s:%s' \"$MISTLE_COMMAND_TEST_VALUE\" \"$(pwd)\" > command-output.txt"

	failure := RunWithDetails(Spec{
		Args: []string{"/bin/sh", "-c", script},
		Env:  map[string]string{"MISTLE_COMMAND_TEST_VALUE": "env-value"},
		CWD:  &tempDir,
	})
	if failure != nil {
		t.Fatalf("expected command to succeed, got %#v", failure)
	}

	output, err := os.ReadFile(outputPath)
	requireNoError(t, err)
	assertEqual(t, string(output), "env-value:"+tempDir)
}

func TestRunWithDetailsCapturesBoundedOutputTails(t *testing.T) {
	stdoutPayload := strings.Repeat("a", defaultStdoutTailMaxBytes+3)
	stderrPayload := strings.Repeat("b", defaultStderrTailMaxBytes+3)
	script := "printf '%s' \"$STDOUT_PAYLOAD\"; printf '%s' \"$STDERR_PAYLOAD\" >&2; exit 1"

	failure := RunWithDetails(Spec{
		Args: []string{"/bin/sh", "-c", script},
		Env: map[string]string{
			"STDOUT_PAYLOAD": stdoutPayload,
			"STDERR_PAYLOAD": stderrPayload,
		},
	})
	if failure == nil {
		t.Fatalf("expected command to fail")
	}

	assertEqual(t, len(*failure.OutputTails.StdoutTail), defaultStdoutTailMaxBytes)
	assertEqual(t, len(*failure.OutputTails.StderrTail), defaultStderrTailMaxBytes)
	assertEqual(t, strings.HasPrefix(*failure.OutputTails.StdoutTail, "a"), true)
	assertEqual(t, strings.HasSuffix(*failure.OutputTails.StderrTail, "b"), true)
}

func TestRunWithDetailsTimesOutAndKillsCommand(t *testing.T) {
	timeoutMS := uint64(50)
	failure := RunWithDetails(Spec{Args: []string{"/bin/sh", "-c", "printf started; sleep 5"}, TimeoutMS: &timeoutMS})

	if failure == nil {
		t.Fatalf("expected command to time out")
	}
	assertEqual(t, failure.Message, "command timed out after 50ms")
	assertEqual(t, failure.TimedOut, true)
	assertEqual(t, *failure.OutputTails.StdoutTail, "started")
}

func TestRunWithDetailsRequiresCommandArgs(t *testing.T) {
	failure := RunWithDetails(Spec{})

	if failure == nil {
		t.Fatalf("expected missing args to fail")
	}
	assertEqual(t, failure.Message, "command args must not be empty")
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
