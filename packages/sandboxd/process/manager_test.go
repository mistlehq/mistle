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
	"time"

	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestRuntimeClientProcessManagerStartsProcessAfterTCPReadiness(t *testing.T) {
	host, port := reserveUnusedLocalPort(t)
	processSpec := managerProcessSpec(
		"tcp-server",
		nodeProcessArgs("require('node:net').createServer(() => {}).listen("+strconv.Itoa(int(port))+", '127.0.0.1')"),
	)
	processSpec.Readiness = runtime.RuntimeClientProcessReadiness{
		Type:      runtime.RuntimeClientProcessReadinessTCP,
		Host:      host,
		Port:      port,
		TimeoutMS: 5_000,
	}

	manager, err := StartRuntimeClientProcessManager(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
	)
	requireNoError(t, err)

	requireNoError(t, manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))
	assertCannotConnect(t, host, port)
}

func TestRuntimeClientProcessManagerStartsProcessAfterHTTPReadiness(t *testing.T) {
	host, port := reserveUnusedLocalPort(t)
	processSpec := managerProcessSpec(
		"http-server",
		nodeProcessArgs("require('node:http').createServer((_, response) => response.end('ok')).listen("+strconv.Itoa(int(port))+", '127.0.0.1')"),
	)
	processSpec.Readiness = runtime.RuntimeClientProcessReadiness{
		Type:           runtime.RuntimeClientProcessReadinessHTTP,
		URL:            "http://" + net.JoinHostPort(host, strconv.Itoa(int(port))) + "/",
		ExpectedStatus: 200,
		TimeoutMS:      5_000,
	}

	manager, err := StartRuntimeClientProcessManager(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
	)
	requireNoError(t, err)

	requireNoError(t, manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))
	assertCannotConnect(t, host, port)
}

func TestRuntimeClientProcessManagerStartsProcessAfterWebSocketReadiness(t *testing.T) {
	host, port := reserveUnusedLocalPort(t)
	processSpec := managerProcessSpec(
		"ws-server",
		nodeProcessArgs(
			"const http = require('node:http');"+
				"http.createServer().on('upgrade', (_request, socket) => {"+
				"socket.write('HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\n\\r\\n');"+
				"}).listen("+strconv.Itoa(int(port))+", '127.0.0.1')",
		),
	)
	processSpec.Readiness = runtime.RuntimeClientProcessReadiness{
		Type:      runtime.RuntimeClientProcessReadinessWS,
		URL:       "ws://" + net.JoinHostPort(host, strconv.Itoa(int(port))) + "/agent",
		TimeoutMS: 5_000,
	}

	manager, err := StartRuntimeClientProcessManager(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
	)
	requireNoError(t, err)

	requireNoError(t, manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))
}

func TestRuntimeClientProcessManagerStartsProcessWithoutReadinessProbe(t *testing.T) {
	processSpec := managerProcessSpec("no-readiness", []string{"/bin/sleep", "30"})
	processSpec.Readiness = runtime.RuntimeClientProcessReadiness{Type: runtime.RuntimeClientProcessReadinessNone}

	manager, err := StartRuntimeClientProcessManager(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
	)
	requireNoError(t, err)

	requireNoError(t, manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))
}

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

func TestOpenCodeControlHandleRestartsAfterManagedServerExit(t *testing.T) {
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-123",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentOpenCodeServer},
	)
	requireNoError(t, err)
	controlDir := t.TempDir()
	exitMarkerPath := filepath.Join(controlDir, "exit-now")
	commandPath := writeExecutableScript(t, "opencode-server", "#!/bin/sh\nif [ -f \"$1\" ]; then exit 0; fi\nsleep 30\n")
	processSpec := managerProcessSpec(OpenCodeServerProcessKey, []string{commandPath, exitMarkerPath})
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

	requireNoError(t, os.WriteFile(exitMarkerPath, []byte("exit-now"), 0o600))
	requireOpenCodeServerSnapshot(t, supervisorHandle, supervision.ComponentRestarting, "Exited")
	requireNoError(t, os.Remove(exitMarkerPath))

	requireNoError(t, controlHandle.Restart(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))

	restartedSnapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentOpenCodeServer)
	if restartedSnapshot == nil {
		t.Fatalf("expected OpenCode server component to remain tracked")
	}
	assertEqual(t, restartedSnapshot.State, supervision.ComponentHealthy)
	assertEqual(t, restartedSnapshot.Details["livenessState"], "Alive")
	assertEqual(t, restartedSnapshot.Details["readinessState"], "Ready")
	if restartedSnapshot.Details["pid"] == "" {
		t.Fatalf("expected restarted OpenCode server pid")
	}
	if restartedSnapshot.Details["pid"] == initialPID {
		t.Fatalf("expected OpenCode server restart to replace pid %s", initialPID)
	}

	requireNoError(t, manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))
}

func TestRuntimeClientProcessManagerNotifiesObserverAroundStartedProcess(t *testing.T) {
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-observer",
		timeutil.SystemClock{},
		nil,
	)
	requireNoError(t, err)
	observer := &recordingRuntimeClientProcessObserver{}
	processSpec := managerProcessSpec("observed-process", []string{"/bin/sleep", "30"})

	manager, err := StartRuntimeClientProcessManagerWithSupervisorAndObserver(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
		supervisorHandle,
		observer,
	)
	requireNoError(t, err)
	defer func() {
		requireNoError(t, manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))
	}()

	assertStringSlicesEqual(t, observer.events, []string{
		"start:observed-process",
		"complete:observed-process",
	})
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

func TestCodexControlHandleCanRestartAfterFailedReplacementExit(t *testing.T) {
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-123",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentCodexAppServer},
	)
	requireNoError(t, err)
	host, port := reserveUnusedLocalPort(t)
	controlDir := t.TempDir()
	failMarkerPath := filepath.Join(controlDir, "fail-next")
	commandPath := writeExecutableScript(t, "codex-server", `#!/bin/sh
fail_marker="$1"
port="$2"
if [ -f "$fail_marker" ]; then
  rm -f "$fail_marker"
  exit 0
fi
exec node -e 'const net = require("node:net"); const port = Number(process.argv[1]); net.createServer(() => {}).listen(port, "127.0.0.1"); setInterval(() => {}, 1000);' "$port"
`)
	processSpec := managerProcessSpec(CodexAppServerProcessKey, []string{commandPath, failMarkerPath, strconv.Itoa(int(port))})
	processSpec.Readiness = runtime.RuntimeClientProcessReadiness{
		Type:      runtime.RuntimeClientProcessReadinessTCP,
		Host:      host,
		Port:      port,
		TimeoutMS: 2_000,
	}
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
	initialPID := controlHandle.ObservationHandle().Snapshot().PID
	if initialPID == nil {
		t.Fatalf("expected initial Codex app-server pid")
	}

	requireNoError(t, os.WriteFile(failMarkerPath, []byte("fail-next"), 0o600))
	restartErr := controlHandle.Restart(timeutil.SystemClock{}, timeutil.ThreadSleeper{})
	if restartErr == nil {
		t.Fatalf("expected first Codex app-server restart to fail")
	}
	if !strings.Contains(restartErr.Error(), "process exited") {
		t.Fatalf("expected replacement exit failure, got %q", restartErr.Error())
	}
	failedSnapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentCodexAppServer)
	if failedSnapshot == nil {
		t.Fatalf("expected Codex app-server component to remain tracked")
	}
	assertEqual(t, failedSnapshot.State, supervision.ComponentRestarting)

	requireNoError(t, controlHandle.Restart(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))

	restartedObservation := controlHandle.ObservationHandle().Snapshot()
	if restartedObservation.PID == nil {
		t.Fatalf("expected restarted Codex app-server pid")
	}
	if *restartedObservation.PID == *initialPID {
		t.Fatalf("expected Codex app-server restart to replace pid %d", *initialPID)
	}
	assertEqual(t, restartedObservation.IsAlive, true)
	assertEqual(t, restartedObservation.LastExitStatus == nil, true)
	restartedSnapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentCodexAppServer)
	if restartedSnapshot == nil {
		t.Fatalf("expected Codex app-server component to remain tracked")
	}
	assertEqual(t, restartedSnapshot.State, supervision.ComponentHealthy)
	assertEqual(t, restartedSnapshot.Details["pid"], strconv.Itoa(int(*restartedObservation.PID)))

	requireNoError(t, manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))
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

func TestRuntimeClientProcessManagerReportsEarlyProcessExitDuringReadiness(t *testing.T) {
	host, port := reserveUnusedLocalPort(t)
	processSpec := managerProcessSpec(
		"exits-early",
		[]string{"/bin/sh", "-c", "exit 7"},
	)
	processSpec.Readiness = runtime.RuntimeClientProcessReadiness{
		Type:      runtime.RuntimeClientProcessReadinessTCP,
		Host:      host,
		Port:      port,
		TimeoutMS: 1_000,
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
	assertEqual(t, managerErr.ProcessKey, "exits-early")
	if !strings.Contains(err.Error(), "process exited with code 7") {
		t.Fatalf("expected early process exit to be reported, got %q", err.Error())
	}
}

func nodeProcessArgs(source string) []string {
	return []string{"node", "-e", source}
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

func assertCannotConnect(t *testing.T, host string, port uint16) {
	t.Helper()
	connection, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(int(port))), 200*time.Millisecond)
	if err != nil {
		return
	}
	_ = connection.Close()
	t.Fatalf("expected runtime client process stop to close %s", net.JoinHostPort(host, strconv.Itoa(int(port))))
}

func writeExecutableScript(t *testing.T, name string, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	requireNoError(t, os.WriteFile(path, []byte(content), 0o700))
	return path
}

func requireOpenCodeServerSnapshot(
	t *testing.T,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	expectedState supervision.ComponentHealthState,
	expectedLivenessState string,
) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		snapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentOpenCodeServer)
		if snapshot != nil && snapshot.State == expectedState && snapshot.Details["livenessState"] == expectedLivenessState {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	snapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentOpenCodeServer)
	t.Fatalf("timed out waiting for OpenCode server snapshot state=%s liveness=%s; last snapshot=%#v", expectedState, expectedLivenessState, snapshot)
}

type recordingRuntimeClientProcessObserver struct {
	events []string
}

func (observer *recordingRuntimeClientProcessObserver) RecordProcessStarted(processSpec RuntimeClientProcessSpec) {
	observer.events = append(observer.events, "start:"+processSpec.ProcessKey)
}

func (observer *recordingRuntimeClientProcessObserver) RecordProcessCompleted(processSpec RuntimeClientProcessSpec) {
	observer.events = append(observer.events, "complete:"+processSpec.ProcessKey)
}

func assertStringSlicesEqual(t *testing.T, actual []string, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
	for index, expectedValue := range expected {
		if actual[index] != expectedValue {
			t.Fatalf("expected %v, got %v", expected, actual)
		}
	}
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
