package sandboxdstate

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mistle/sandboxd/runtime"
)

func TestBuildSetupScriptEnvironmentMatchesPTYBasics(t *testing.T) {
	environment := BuildSetupScriptEnvironment(map[string]string{"MISTLE_TEST_ENV": "runtime-value"})

	assertEqual(t, environment["TERM"], DefaultPTYTerm)
	assertEqual(t, environment["MISTLE_TEST_ENV"], "runtime-value")
	assertEqual(t, SetupScriptWorkingDirectory, "/root")
}

func TestRunSetupScriptSkipsMissingOrBlankScripts(t *testing.T) {
	missingScriptPlan := testRuntimePlan(nil)
	if failure := RunSetupScriptInDirectory(missingScriptPlan, nil, t.TempDir()); failure != nil {
		t.Fatalf("expected missing setup script to be a no-op, got %#v", failure)
	}

	blankScript := "   \n\t  "
	blankScriptPlan := testRuntimePlan(&blankScript)
	if failure := RunSetupScriptInDirectory(blankScriptPlan, nil, t.TempDir()); failure != nil {
		t.Fatalf("expected blank setup script to be a no-op, got %#v", failure)
	}
}

func TestRunSetupScriptHonorsUserShebang(t *testing.T) {
	outputPath := filepath.Join(t.TempDir(), "setup-script-output.txt")
	script := "#!/bin/false\nprintf 'script body ran' > " + outputPath
	runtimePlan := testRuntimePlan(&script)

	failure := RunSetupScriptInDirectory(runtimePlan, nil, t.TempDir())

	if failure == nil {
		t.Fatalf("expected setup script to execute through user shebang and fail")
	}
	if _, err := os.Stat(outputPath); err == nil {
		t.Fatalf("expected setup script body not to run when shebang interpreter exits first")
	} else if !os.IsNotExist(err) {
		t.Fatalf("expected missing output file, got %v", err)
	}
}

func TestRunSetupScriptUsesWorkingDirectoryAndRuntimeEnvironment(t *testing.T) {
	workingDirectory := t.TempDir()
	outputPath := filepath.Join(t.TempDir(), "setup-script-output.txt")
	script := "printf '%s\\n' \"$TERM\" > " + outputPath +
		"; printf '%s\\n' \"$MISTLE_TEST_ENV\" >> " + outputPath +
		"; pwd >> " + outputPath +
		"; printf '%s\\n' \"$0\" >> " + outputPath +
		"; test -x \"$0\" && printf 'executable\\n' >> " + outputPath
	runtimePlan := testRuntimePlan(&script)

	failure := RunSetupScriptInDirectory(runtimePlan, map[string]string{"MISTLE_TEST_ENV": "runtime-value"}, workingDirectory)
	if failure != nil {
		t.Fatalf("expected setup script to succeed, got %#v", failure)
	}

	output, err := os.ReadFile(outputPath)
	requireNoError(t, err)
	outputLines := strings.Split(strings.TrimSpace(string(output)), "\n")
	canonicalWorkingDirectory, err := filepath.EvalSymlinks(workingDirectory)
	requireNoError(t, err)
	assertEqual(t, outputLines[0], DefaultPTYTerm)
	assertEqual(t, outputLines[1], "runtime-value")
	assertEqual(t, outputLines[2], canonicalWorkingDirectory)
	setupScriptPath := outputLines[3]
	assertEqual(t, outputLines[4], "executable")
	if _, err := os.Stat(setupScriptPath); err == nil {
		t.Fatalf("expected temporary setup script to be removed")
	} else if !os.IsNotExist(err) {
		t.Fatalf("expected setup script to be absent, got %v", err)
	}
}

func TestRunSetupScriptCapturesStdoutAndStderrOnFailure(t *testing.T) {
	script := "printf '%s\\nstdout-line' \"$0\"; printf 'stderr-line' >&2; exit 17"
	runtimePlan := testRuntimePlan(&script)

	failure := RunSetupScriptInDirectory(runtimePlan, nil, t.TempDir())

	if failure == nil {
		t.Fatalf("expected failing setup script to return an error")
	}
	assertEqual(t, *failure.ExitCode, 17)
	assertEqual(t, failure.TimedOut, false)
	assertEqual(t, failure.OutputTails.StdoutCaptured, true)
	assertEqual(t, failure.OutputTails.StderrCaptured, true)
	stdoutTail := *failure.OutputTails.StdoutTail
	stdoutLines := strings.Split(stdoutTail, "\n")
	setupScriptPath := stdoutLines[0]
	if _, err := os.Stat(setupScriptPath); err == nil {
		t.Fatalf("expected temporary setup script to be removed after failure")
	} else if !os.IsNotExist(err) {
		t.Fatalf("expected setup script to be absent, got %v", err)
	}
	assertEqual(t, stdoutLines[1], "stdout-line")
	assertEqual(t, *failure.OutputTails.StderrTail, "stderr-line")
}

func testRuntimePlan(setupScript *string) runtime.CompiledRuntimePlan {
	return runtime.CompiledRuntimePlan{
		SandboxProfileID: "sbp_setup_script",
		Version:          1,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   runtime.CompiledRuntimePlanImageBase,
			ImageRef: "registry.example.test/base:latest",
		},
		SetupScript: setupScript,
	}
}
