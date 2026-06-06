package process

import (
	"encoding/json"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestCodexAppServerMonitorMarksReadinessUnreachableAfterFailureThreshold(t *testing.T) {
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-123",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentCodexAppServer},
	)
	requireNoError(t, err)
	controlHandle, cleanup := startManagedCodexAppServerProcess(t, supervisorHandle, codexMonitorSpec(t))
	defer cleanup()
	state := newRuntimeClientProcessMonitorState()

	requireNoError(t, observeCodexAppServerProcess(controlHandle, &state))
	requireNoError(t, observeCodexAppServerProcess(controlHandle, &state))
	requireNoError(t, observeCodexAppServerProcess(controlHandle, &state))

	snapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentCodexAppServer)
	if snapshot == nil {
		t.Fatalf("expected Codex app-server component to be tracked")
	}
	assertEqual(t, snapshot.State, supervision.ComponentRestarting)
	assertEqual(t, snapshot.Details["readinessState"], "Unreachable")
	assertEqual(t, snapshot.Details["livenessState"], "Alive")
	lines := supervisorHandle.DrainForwardedLifecycleEventLines()
	payload := requireLifecycleEventPayload(t, lines, "component_healthcheck_failed")
	assertEqual(t, payload["reason"].(string), "readiness_probe_failed")
	assertEqual(t, payload["probeKind"].(string), "readiness_http_readyz")
	assertEqual(t, payload["consecutiveFailures"].(string), "3")
	assertEqual(t, payload["failureThreshold"].(string), "3")
}

func TestOpenCodeServerMonitorProjectsExitedProcessToSupervisor(t *testing.T) {
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-123",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentOpenCodeServer},
	)
	requireNoError(t, err)
	processSpec := managerProcessSpec(OpenCodeServerProcessKey, []string{"/bin/sh", "-c", "exit 7"})
	process, err := StartRuntimeClientProcess(processSpec)
	requireNoError(t, err)
	controlHandle := &OpenCodeServerControlHandle{
		managedProcess: managedOpenCodeServerProcess{
			process:          &managedRuntimeClientProcess{process: process},
			supervisorHandle: supervisorHandle,
		},
	}
	state := newRuntimeClientProcessMonitorState()

	requireEventuallyOpenCodeExit(t, supervisorHandle, func() error {
		return observeOpenCodeServerProcess(controlHandle, &state)
	})

	snapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentOpenCodeServer)
	if snapshot == nil {
		t.Fatalf("expected OpenCode server component to be tracked")
	}
	assertEqual(t, snapshot.State, supervision.ComponentRestarting)
	assertEqual(t, snapshot.Details["livenessState"], "Exited")
	assertEqual(t, snapshot.Details["readinessState"], "Ready")
	assertEqual(t, snapshot.Details["lastExitStatus"], "process exited with code 7")
	lines := supervisorHandle.DrainForwardedLifecycleEventLines()
	payload := requireLifecycleEventPayload(t, lines, "component_exited")
	assertEqual(t, payload["reason"].(string), "process_exited")
	assertEqual(t, payload["exitKind"].(string), "process_exited")
	assertEqual(t, int(payload["exitCode"].(float64)), 7)
}

func startManagedCodexAppServerProcess(
	t *testing.T,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	processSpec RuntimeClientProcessSpec,
) (*CodexAppServerControlHandle, func()) {
	t.Helper()
	process, err := StartRuntimeClientProcess(processSpec)
	requireNoError(t, err)
	processID := process.PID()
	observationHandle := NewCodexAppServerObservationHandle(processSpec, processID, true, nil)
	managedProcess := &managedRuntimeClientProcess{process: process}
	controlHandle := &CodexAppServerControlHandle{
		managedProcess: managedCodexAppServerProcess{
			process:          managedProcess,
			observation:      observationHandle,
			supervisorHandle: supervisorHandle,
		},
	}
	supervisorHandle.ReplaceComponentDetails(
		supervision.ComponentCodexAppServer,
		CodexAppServerDetailsWithStatus(processSpec, &processID, nil, "Alive", "Ready"),
	)
	supervisorHandle.MarkComponentHealthy(supervision.ComponentCodexAppServer)
	return controlHandle, func() {
		_ = managedProcess.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{})
	}
}

func codexMonitorSpec(t *testing.T) RuntimeClientProcessSpec {
	t.Helper()
	host, port := reserveUnusedLocalPort(t)
	processSpec := managerProcessSpec(CodexAppServerProcessKey, []string{"/bin/sleep", "30"})
	processSpec.Readiness = runtime.RuntimeClientProcessReadiness{
		Type:      runtime.RuntimeClientProcessReadinessWS,
		URL:       "ws://" + net.JoinHostPort(host, strconv.Itoa(int(port))) + "/agent",
		TimeoutMS: 1,
	}
	return processSpec
}

func requireLifecycleEventPayload(t *testing.T, lines []string, expectedEvent string) map[string]any {
	t.Helper()
	for _, line := range lines {
		var payload map[string]any
		requireNoError(t, json.Unmarshal([]byte(line), &payload))
		if payload["event"] == expectedEvent {
			return payload
		}
	}
	t.Fatalf("expected lifecycle event %s in %v", expectedEvent, lines)
	return nil
}

func requireEventuallyOpenCodeExit(
	t *testing.T,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	observe func() error,
) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		err := observe()
		if err != nil {
			t.Fatalf("expected observation to succeed, got %v", err)
		}
		snapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentOpenCodeServer)
		if snapshot != nil && snapshot.Details["livenessState"] == "Exited" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected OpenCode server exit projection before timeout")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
