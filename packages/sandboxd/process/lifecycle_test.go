package process

import (
	"net"
	"strconv"
	"strings"
	"testing"

	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/timeutil"
)

func TestStartRuntimeClientProcessCapturesOutputAndHonorsEnvironmentAndWorkingDirectory(t *testing.T) {
	workingDirectory := t.TempDir()
	processSpec := lifecycleProcessSpec("env-cwd", runtime.RuntimeExecCommand{
		Args: []string{"/bin/sh", "-c", "printf '%s:%s' \"$MISTLE_TEST_PROCESS_ENV\" \"$PWD\"; printf 'stderr-line' >&2"},
		Env: map[string]string{
			"MISTLE_TEST_PROCESS_ENV": "runtime-value",
		},
		CWD: &workingDirectory,
	})

	process, err := StartRuntimeClientProcess(processSpec)
	requireNoError(t, err)
	requireNoError(t, WaitForRuntimeClientProcessExit(process, 2_000, timeutil.SystemClock{}, timeutil.ThreadSleeper{}))

	tails := process.OutputCapture().CollectTailsAfterProcessExit()
	if tails.StdoutTail == nil {
		t.Fatalf("expected stdout tail")
	}
	assertEqual(t, *tails.StdoutTail, "runtime-value:"+workingDirectory)
	assertEqual(t, *tails.StderrTail, "stderr-line")
}

func TestStartRuntimeClientProcessRejectsEmptyCommandArgs(t *testing.T) {
	_, err := StartRuntimeClientProcess(lifecycleProcessSpec("empty", runtime.RuntimeExecCommand{}))

	if err == nil {
		t.Fatalf("expected empty process command args to fail")
	}
	assertEqual(t, err.Error(), "process command args must not be empty")
}

func TestStopRuntimeClientProcessSignalsRunningProcess(t *testing.T) {
	processSpec := lifecycleProcessSpec("sleep", runtime.RuntimeExecCommand{
		Args: []string{"/bin/sleep", "30"},
	})
	processSpec.Stop = runtime.RuntimeClientProcessStopPolicy{
		Signal:    runtime.RuntimeClientProcessStopSignalSIGKILL,
		TimeoutMS: 2_000,
	}
	process, err := StartRuntimeClientProcess(processSpec)
	requireNoError(t, err)

	requireNoError(t, StopRuntimeClientProcess(process, timeutil.SystemClock{}, timeutil.ThreadSleeper{}))

	exited, err := ProcessHasExited(process)
	requireNoError(t, err)
	assertEqual(t, exited, true)
}

func TestStopStartedProcessesReportsErrorsWithProcessKeysInReverseOrder(t *testing.T) {
	firstSpec := lifecycleProcessSpec("first", runtime.RuntimeExecCommand{Args: []string{"/bin/sleep", "30"}})
	firstSpec.Stop.Signal = runtime.RuntimeClientProcessStopSignal("SIGUSR1")
	first, err := StartRuntimeClientProcess(firstSpec)
	requireNoError(t, err)
	defer cleanupRunningProcess(t, first)

	secondSpec := lifecycleProcessSpec("second", runtime.RuntimeExecCommand{Args: []string{"/bin/sleep", "30"}})
	secondSpec.Stop.Signal = runtime.RuntimeClientProcessStopSignal("SIGUSR1")
	second, err := StartRuntimeClientProcess(secondSpec)
	requireNoError(t, err)
	defer cleanupRunningProcess(t, second)

	err = StopStartedProcesses([]*RunningRuntimeClientProcess{first, second}, timeutil.SystemClock{}, timeutil.ThreadSleeper{})

	if err == nil {
		t.Fatalf("expected malformed running processes to report stop errors")
	}
	errorText := err.Error()
	if !strings.Contains(errorText, "processKey=second") || !strings.Contains(errorText, "processKey=first") {
		t.Fatalf("expected both process keys in stop error, got %q", errorText)
	}
	if strings.Index(errorText, "processKey=second") > strings.Index(errorText, "processKey=first") {
		t.Fatalf("expected reverse-order stop errors, got %q", errorText)
	}
}

func TestWaitForRuntimeClientProcessReadinessChecksZeroTimeoutProbe(t *testing.T) {
	host, port := reserveUnusedLocalPort(t)
	processSpec := lifecycleProcessSpec("zero-timeout-readiness", runtime.RuntimeExecCommand{
		Args: []string{"/bin/sleep", "30"},
	})
	processSpec.Readiness = runtime.RuntimeClientProcessReadiness{
		Type:           runtime.RuntimeClientProcessReadinessHTTP,
		URL:            "http://" + net.JoinHostPort(host, strconv.Itoa(int(port))) + "/readyz",
		ExpectedStatus: 200,
		TimeoutMS:      0,
	}
	processSpec.Stop.Signal = runtime.RuntimeClientProcessStopSignalSIGKILL
	process, err := StartRuntimeClientProcess(processSpec)
	requireNoError(t, err)
	defer cleanupRunningProcess(t, process)

	err = WaitForRuntimeClientProcessReadiness(process, timeutil.SystemClock{}, timeutil.ThreadSleeper{})

	if err == nil {
		t.Fatalf("expected zero-timeout readiness probe to fail when target is unavailable")
	}
	if !strings.Contains(err.Error(), "timed out after 0ms waiting for readiness") {
		t.Fatalf("expected zero-timeout readiness failure, got %q", err.Error())
	}
}

func cleanupRunningProcess(t *testing.T, process *RunningRuntimeClientProcess) {
	t.Helper()
	_ = SignalRuntimeClientProcess(process, runtime.RuntimeClientProcessStopSignalSIGKILL)
	_ = WaitForRuntimeClientProcessExit(process, 2_000, timeutil.SystemClock{}, timeutil.ThreadSleeper{})
	process.OutputCapture().FinishCaptureReaders()
}

func lifecycleProcessSpec(processKey string, command runtime.RuntimeExecCommand) RuntimeClientProcessSpec {
	return RuntimeClientProcessSpec{
		ProcessKey: processKey,
		Command:    command,
		Readiness:  runtime.RuntimeClientProcessReadiness{Type: runtime.RuntimeClientProcessReadinessNone},
		Stop: runtime.RuntimeClientProcessStopPolicy{
			Signal:    runtime.RuntimeClientProcessStopSignalSIGTERM,
			TimeoutMS: 2_000,
		},
	}
}
