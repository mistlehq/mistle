package sandboxdstate

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/idempotency"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/process"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestCoordinateOpenCodeRuntimeRestartsServerMarkedRestarting(t *testing.T) {
	supervisorHandle := newCoordinationSupervisor(t, []supervision.SupervisedComponent{
		supervision.ComponentOpenCodeServer,
	})
	processManager := startCoordinationProcessManager(t, supervisorHandle, process.OpenCodeServerProcessKey)
	defer processManager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{})
	controlHandle := processManager.OpenCodeServerControlHandle()
	if controlHandle == nil {
		t.Fatalf("expected OpenCode server control handle")
	}
	initialSnapshot := requireCoordinationComponentSnapshot(t, supervisorHandle, supervision.ComponentOpenCodeServer)
	initialPID := initialSnapshot.Details["pid"]
	supervisorHandle.MarkComponentRestarting(supervision.ComponentOpenCodeServer, "readiness failed")

	coordinateOpenCodeRuntime(controlHandle, supervisorHandle, timeutil.SystemClock{}, timeutil.ThreadSleeper{})

	restartedSnapshot := requireCoordinationComponentSnapshot(t, supervisorHandle, supervision.ComponentOpenCodeServer)
	assertEqual(t, restartedSnapshot.State, supervision.ComponentHealthy)
	if restartedSnapshot.Details["pid"] == "" {
		t.Fatalf("expected restarted OpenCode server pid")
	}
	if restartedSnapshot.Details["pid"] == initialPID {
		t.Fatalf("expected OpenCode server restart to replace pid %s", initialPID)
	}
	assertCoordinationRestartScheduled(t, supervisorHandle, supervision.ComponentOpenCodeServer)
}

func TestCoordinateCodexRuntimeRestartsAppServerMarkedRestarting(t *testing.T) {
	supervisorHandle := newCoordinationSupervisor(t, []supervision.SupervisedComponent{
		supervision.ComponentCodexAppServer,
		supervision.ComponentCodexProxy,
	})
	processManager := startCoordinationProcessManager(t, supervisorHandle, process.CodexAppServerProcessKey)
	defer processManager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{})
	rawServer := startCoordinationRawCodexServer(t)
	store, err := idempotency.LoadStore(t.TempDir())
	requireNoError(t, err)
	codexProxy, err := StartCodexProxyWithIdempotencyStore(
		CodexProxyPlan{
			ListenURL: reserveLifecycleWebSocketURL(t),
			RawURL:    "ws" + strings.TrimPrefix(rawServer.URL, "http"),
		},
		supervisorHandle,
		keepalive.NewSharedManager(),
		store,
	)
	requireNoError(t, err)
	defer codexProxy.Close()
	controlHandle := processManager.CodexAppServerControlHandle()
	if controlHandle == nil {
		t.Fatalf("expected Codex app-server control handle")
	}
	initialObservation := controlHandle.ObservationHandle().Snapshot()
	if initialObservation.PID == nil {
		t.Fatalf("expected initial Codex app-server pid")
	}
	supervisorHandle.MarkComponentRestarting(supervision.ComponentCodexAppServer, "process exited")

	codexProxyControlHandle := codexProxy.ControlHandle()
	coordinateCodexRuntime(controlHandle, &codexProxyControlHandle, supervisorHandle, timeutil.SystemClock{}, timeutil.ThreadSleeper{}, make(chan struct{}))

	restartedObservation := controlHandle.ObservationHandle().Snapshot()
	if restartedObservation.PID == nil {
		t.Fatalf("expected restarted Codex app-server pid")
	}
	if *restartedObservation.PID == *initialObservation.PID {
		t.Fatalf("expected Codex app-server restart to replace pid %d", *initialObservation.PID)
	}
	restartedSnapshot := requireCoordinationComponentSnapshot(t, supervisorHandle, supervision.ComponentCodexAppServer)
	assertEqual(t, restartedSnapshot.State, supervision.ComponentHealthy)
	assertEqual(t, restartedSnapshot.Details["pid"], strconv.Itoa(int(*restartedObservation.PID)))
	assertCoordinationRestartScheduled(t, supervisorHandle, supervision.ComponentCodexAppServer)
}

func TestCodexProxyControlHandleRequestRestartReconnectsSessionManager(t *testing.T) {
	sessionManagerInitializes := atomic.Int32{}
	rawServer := startCoordinationRawCodexServerWithInitializeCount(t, &sessionManagerInitializes)
	supervisorHandle := newCoordinationSupervisor(t, []supervision.SupervisedComponent{
		supervision.ComponentCodexProxy,
	})
	store, err := idempotency.LoadStore(t.TempDir())
	requireNoError(t, err)
	codexProxy, err := StartCodexProxyWithIdempotencyStore(
		CodexProxyPlan{
			ListenURL: reserveLifecycleWebSocketURL(t),
			RawURL:    "ws" + strings.TrimPrefix(rawServer.URL, "http"),
		},
		supervisorHandle,
		keepalive.NewSharedManager(),
		store,
	)
	requireNoError(t, err)
	defer codexProxy.Close()
	waitForAtomicAtLeast(t, &sessionManagerInitializes, 1)

	controlHandle := codexProxy.ControlHandle()
	requireNoError(t, controlHandle.RequestRestart())

	waitForAtomicAtLeast(t, &sessionManagerInitializes, 2)
}

func newCoordinationSupervisor(t *testing.T, components []supervision.SupervisedComponent) *supervision.SandboxdSupervisorHandle {
	t.Helper()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle("sbi_coordination", timeutil.SystemClock{}, components)
	requireNoError(t, err)
	return supervisorHandle
}

func startCoordinationProcessManager(
	t *testing.T,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	processKey string,
) *process.RuntimeClientProcessManager {
	t.Helper()
	processSpec := process.RuntimeClientProcessSpec{
		ProcessKey: processKey,
		Command:    runtime.RuntimeExecCommand{Args: []string{"/bin/sleep", "30"}},
		Readiness:  runtime.RuntimeClientProcessReadiness{Type: runtime.RuntimeClientProcessReadinessNone},
		Stop: runtime.RuntimeClientProcessStopPolicy{
			Signal:    runtime.RuntimeClientProcessStopSignalSIGKILL,
			TimeoutMS: 2_000,
		},
	}
	processManager, err := process.StartRuntimeClientProcessManagerWithSupervisor(
		[]process.RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
		supervisorHandle,
	)
	requireNoError(t, err)
	return processManager
}

func startCoordinationRawCodexServer(t *testing.T) *httptest.Server {
	t.Helper()
	return startCoordinationRawCodexServerWithInitializeCount(t, nil)
}

func startCoordinationRawCodexServerWithInitializeCount(t *testing.T, initializes *atomic.Int32) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		handleCoordinationRawCodexConnection(t, request.Context(), connection, initializes)
	}))
	t.Cleanup(server.Close)
	return server
}

func handleCoordinationRawCodexConnection(
	t *testing.T,
	ctx context.Context,
	connection *websocket.Conn,
	initializes *atomic.Int32,
) {
	for {
		_, payload, err := connection.Read(ctx)
		if err != nil {
			return
		}
		var request map[string]any
		if err := json.Unmarshal(payload, &request); err != nil {
			t.Errorf("expected raw Codex request JSON: %v", err)
			return
		}
		switch request["method"] {
		case "initialize":
			if initializes != nil {
				initializes.Add(1)
			}
			writeCodexProxyTestJSON(t, connection, map[string]any{"id": request["id"], "result": map[string]any{}})
		case "initialized":
		case "thread/loaded/list":
			writeCodexProxyTestJSON(t, connection, map[string]any{"id": request["id"], "result": map[string]any{"data": []any{}}})
		default:
			if request["id"] != nil {
				writeCodexProxyTestJSON(t, connection, map[string]any{
					"id": request["id"],
					"result": map[string]any{
						"thread": map[string]any{
							"status": map[string]any{"type": "idle"},
						},
					},
				})
			}
		}
	}
}

func requireCoordinationComponentSnapshot(
	t *testing.T,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	component supervision.SupervisedComponent,
) *supervision.ComponentHealthSnapshot {
	t.Helper()
	snapshot := supervisorHandle.ComponentSnapshot(component)
	if snapshot == nil {
		t.Fatalf("expected component %s to be tracked", component)
	}
	return snapshot
}

func assertCoordinationRestartScheduled(
	t *testing.T,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	component supervision.SupervisedComponent,
) {
	t.Helper()
	lines := supervisorHandle.DrainForwardedLifecycleEventLines()
	componentName := ""
	switch component {
	case supervision.ComponentCodexAppServer:
		componentName = string(supervision.ComponentCodexAppServer)
	case supervision.ComponentOpenCodeServer:
		componentName = string(supervision.ComponentOpenCodeServer)
	default:
		t.Fatalf("unsupported coordinated component %s", component)
	}
	for _, line := range lines {
		if strings.Contains(line, `"event":"component_restart_scheduled"`) &&
			strings.Contains(line, `"component":"`+componentName+`"`) {
			return
		}
	}
	t.Fatalf("expected component_restart_scheduled event for %s in lifecycle lines: %v", component, lines)
}

func waitForAtomicAtLeast(t *testing.T, value *atomic.Int32, expected int32) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if value.Load() >= expected {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected atomic value to reach %d, got %d", expected, value.Load())
		}
		time.Sleep(10 * time.Millisecond)
	}
}
