package process

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"

	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestRuntimeClientProcessManagerMarksTrackedCodexServerHealthyAndStopped(t *testing.T) {
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-123",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentCodexAppServer},
	)
	requireNoError(t, err)
	processSpec := managerProcessSpec(CodexAppServerProcessKey, []string{"/bin/sleep", "30"})

	manager, err := StartRuntimeClientProcessManagerWithSupervisor(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
		supervisorHandle,
	)
	requireNoError(t, err)

	healthySnapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentCodexAppServer)
	if healthySnapshot == nil {
		t.Fatalf("expected Codex app-server component to be tracked")
	}
	assertEqual(t, healthySnapshot.State, supervision.ComponentHealthy)
	assertEqual(t, healthySnapshot.Details["processKey"], CodexAppServerProcessKey)
	assertEqual(t, healthySnapshot.Details["livenessState"], "Alive")
	assertEqual(t, healthySnapshot.Details["readinessState"], "Ready")
	if healthySnapshot.Details["pid"] == "" {
		t.Fatalf("expected tracked Codex app-server details to include pid")
	}

	requireNoError(t, manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))

	stoppedSnapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentCodexAppServer)
	if stoppedSnapshot == nil {
		t.Fatalf("expected Codex app-server component to remain tracked after stop")
	}
	assertEqual(t, stoppedSnapshot.State, supervision.ComponentStopped)
}

func TestRuntimeClientProcessManagerExposesCodexControlHandleThatRestartsCurrentProcess(t *testing.T) {
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-123",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentCodexAppServer},
	)
	requireNoError(t, err)
	processSpec := managerProcessSpec(CodexAppServerProcessKey, []string{"/bin/sleep", "30"})
	manager, err := StartRuntimeClientProcessManagerWithSupervisor(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
		supervisorHandle,
	)
	requireNoError(t, err)

	controlHandle := manager.CodexAppServerControlHandle()
	if controlHandle == nil {
		t.Fatalf("expected Codex app-server control handle")
	}
	initialObservation := controlHandle.ObservationHandle().Snapshot()
	if initialObservation.PID == nil {
		t.Fatalf("expected initial Codex app-server observation pid")
	}

	requireNoError(t, controlHandle.Restart(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))

	restartedObservation := controlHandle.ObservationHandle().Snapshot()
	if restartedObservation.PID == nil {
		t.Fatalf("expected restarted Codex app-server observation pid")
	}
	if *restartedObservation.PID == *initialObservation.PID {
		t.Fatalf("expected Codex app-server restart to replace pid %d", *initialObservation.PID)
	}
	assertEqual(t, restartedObservation.IsAlive, true)
	assertEqual(t, restartedObservation.LastExitStatus == nil, true)

	snapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentCodexAppServer)
	if snapshot == nil {
		t.Fatalf("expected Codex app-server component to be tracked")
	}
	assertEqual(t, snapshot.State, supervision.ComponentHealthy)
	assertEqual(t, snapshot.Details["pid"], strconv.Itoa(int(*restartedObservation.PID)))

	requireNoError(t, manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))
	assertPIDExited(t, *restartedObservation.PID)
}

func TestRuntimeClientProcessManagerExposesOpenCodeControlHandleThatRestartsCurrentProcess(t *testing.T) {
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-123",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentOpenCodeServer},
	)
	requireNoError(t, err)
	processSpec := managerProcessSpec(OpenCodeServerProcessKey, []string{"/bin/sleep", "30"})
	manager, err := StartRuntimeClientProcessManagerWithSupervisor(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
		supervisorHandle,
	)
	requireNoError(t, err)

	controlHandle := manager.OpenCodeServerControlHandle()
	if controlHandle == nil {
		t.Fatalf("expected OpenCode server control handle")
	}
	initialSnapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentOpenCodeServer)
	if initialSnapshot == nil {
		t.Fatalf("expected OpenCode server component to be tracked")
	}
	initialPID := initialSnapshot.Details["pid"]

	requireNoError(t, controlHandle.Restart(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))

	restartedSnapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentOpenCodeServer)
	if restartedSnapshot == nil {
		t.Fatalf("expected OpenCode server component to remain tracked")
	}
	assertEqual(t, restartedSnapshot.State, supervision.ComponentHealthy)
	if restartedSnapshot.Details["pid"] == "" {
		t.Fatalf("expected restarted OpenCode server pid")
	}
	if restartedSnapshot.Details["pid"] == initialPID {
		t.Fatalf("expected OpenCode server restart to replace pid %s", initialPID)
	}

	requireNoError(t, manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))
}

func TestCodexControlHandleReportsRestartSpawnFailureThroughSupervisor(t *testing.T) {
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-123",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentCodexAppServer},
	)
	requireNoError(t, err)
	commandPath := writeExecutableScript(t, "codex-server", "#!/bin/sh\nsleep 30\n")
	processSpec := managerProcessSpec(CodexAppServerProcessKey, []string{commandPath})
	manager, err := StartRuntimeClientProcessManagerWithSupervisor(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
		supervisorHandle,
	)
	requireNoError(t, err)
	controlHandle := manager.CodexAppServerControlHandle()
	if controlHandle == nil {
		t.Fatalf("expected Codex app-server control handle")
	}
	requireNoError(t, os.Remove(commandPath))

	err = controlHandle.Restart(timeutil.SystemClock{}, timeutil.ThreadSleeper{})

	if err == nil {
		t.Fatalf("expected Codex app-server restart to fail after executable removal")
	}
	snapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentCodexAppServer)
	if snapshot == nil {
		t.Fatalf("expected Codex app-server component to remain tracked")
	}
	assertEqual(t, snapshot.State, supervision.ComponentRestarting)
	if snapshot.LastError == nil {
		t.Fatalf("expected restart failure to be recorded")
	}
	if !strings.Contains(*snapshot.LastError, "failed to start process command") {
		t.Fatalf("expected restart spawn failure, got %q", *snapshot.LastError)
	}

	_ = manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{})
}

func TestRuntimeClientProcessManagerReportsStartFailureWithProcessIndexAndKey(t *testing.T) {
	processSpec := managerProcessSpec("missing-command", []string{"/path/to/missing/mistle-process"})

	_, err := StartRuntimeClientProcessManager(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
	)

	var managerErr *ProcessManagerError
	if !errors.As(err, &managerErr) {
		t.Fatalf("expected process manager error, got %T: %v", err, err)
	}
	assertEqual(t, managerErr.Kind, ProcessManagerStartProcessError)
	assertEqual(t, *managerErr.ProcessIndex, 0)
	assertEqual(t, managerErr.ProcessKey, "missing-command")
	if !strings.Contains(err.Error(), "runtime client process[0] failed to start (processKey=missing-command)") {
		t.Fatalf("expected start failure message to include process index and key, got %q", err.Error())
	}
}

func TestRuntimeClientProcessManagerReportsReadinessFailureDetails(t *testing.T) {
	host, port := reserveUnusedLocalPort(t)
	processSpec := managerProcessSpec(
		"not-ready",
		[]string{"/bin/sh", "-c", "printf readiness-output; sleep 30"},
	)
	processSpec.Readiness = runtime.RuntimeClientProcessReadiness{
		Type:           runtime.RuntimeClientProcessReadinessHTTP,
		URL:            "http://" + net.JoinHostPort(host, strconv.Itoa(int(port))) + "/readyz",
		ExpectedStatus: 200,
		TimeoutMS:      150,
	}

	_, err := StartRuntimeClientProcessManager(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
	)

	var managerErr *ProcessManagerError
	if !errors.As(err, &managerErr) {
		t.Fatalf("expected process manager error, got %T: %v", err, err)
	}
	assertEqual(t, managerErr.Kind, ProcessManagerReadinessCheckError)
	assertEqual(t, *managerErr.ProcessIndex, 0)
	assertEqual(t, managerErr.ProcessKey, "not-ready")
	if managerErr.ReadinessFailure == nil {
		t.Fatalf("expected readiness failure details")
	}
	assertEqual(t, managerErr.ReadinessFailure.ReadinessType, "http")
	assertEqual(t, managerErr.ReadinessFailure.ReadinessTarget, processSpec.Readiness.URL)
	assertEqual(t, managerErr.ReadinessFailure.TimeoutMS, uint64(150))
	if managerErr.ReadinessFailure.OutputTails.StdoutTail == nil {
		t.Fatalf("expected readiness failure output tails to include stdout")
	}
	assertEqual(t, *managerErr.ReadinessFailure.OutputTails.StdoutTail, "readiness-output")
}

func managerProcessSpec(processKey string, args []string) RuntimeClientProcessSpec {
	return RuntimeClientProcessSpec{
		ProcessKey: processKey,
		Command:    runtime.RuntimeExecCommand{Args: args},
		Readiness:  runtime.RuntimeClientProcessReadiness{Type: runtime.RuntimeClientProcessReadinessNone},
		Stop: runtime.RuntimeClientProcessStopPolicy{
			Signal:    runtime.RuntimeClientProcessStopSignalSIGKILL,
			TimeoutMS: 2_000,
		},
	}
}

func reserveUnusedLocalPort(t *testing.T) (string, uint16) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	defer listener.Close()

	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("expected TCP listener address, got %T", listener.Addr())
	}
	return address.IP.String(), uint16(address.Port)
}

func writeExecutableScript(t *testing.T, name string, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	requireNoError(t, os.WriteFile(path, []byte(content), 0o700))
	return path
}

func assertPIDExited(t *testing.T, pid uint32) {
	t.Helper()
	err := syscall.Kill(int(pid), 0)
	if errors.Is(err, syscall.ESRCH) {
		return
	}
	if err == nil {
		t.Fatalf("expected pid %d to have exited", pid)
	}
	t.Fatalf("failed to check pid %d liveness: %v", pid, err)
}
