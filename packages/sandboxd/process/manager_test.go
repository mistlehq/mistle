package process

import (
	"errors"
	"net"
	"strconv"
	"strings"
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
		TimeoutMS:      1,
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
	assertEqual(t, managerErr.ReadinessFailure.TimeoutMS, uint64(1))
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
