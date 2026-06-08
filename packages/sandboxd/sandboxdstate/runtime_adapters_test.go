package sandboxdstate

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/idempotency"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/piproxy"
	"github.com/mistle/sandboxd/process"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestStartRuntimeAdaptersStartsCodexProxyFromDedicatedRuntimeEndpoint(t *testing.T) {
	rawServer := startRuntimeAdaptersSimulatedCodexServer(t)
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-runtime-adapters-codex-test",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{
			supervision.ComponentCodexProxy,
			supervision.ComponentRuntimeAgentEndpoint,
		},
	)
	requireNoError(t, err)
	sharedKeepalive := keepalive.NewSharedManager()

	adapters, err := StartRuntimeAdapters(
		runtimeAdaptersCodexRuntimePlan("ws"+rawServer.URL[len("http"):]+"/raw"),
		supervisorHandle,
		sharedKeepalive,
		runtimeAdaptersTestOptions(t),
	)

	requireNoError(t, err)
	defer adapters.Close()
	if len(adapters.codexProxies) != 1 {
		t.Fatalf("expected one Codex proxy handle, got %d", len(adapters.codexProxies))
	}
	waitForComponentState(t, supervisorHandle, supervision.ComponentCodexProxy, supervision.ComponentHealthy)
	waitForComponentState(t, supervisorHandle, supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentHealthy)
	runtimeAdaptersRequireEventually(t, sharedKeepalive.Active)

	connection := runtimeAdaptersDialWebSocket(t, adapters.codexProxies[0].ListenURL())
	defer connection.CloseNow()
	requestID := float64(401)
	runtimeAdaptersWriteJSON(t, connection, map[string]any{
		"id":     requestID,
		"method": "thread/loaded/list",
		"params": map[string]any{},
	})
	response := runtimeAdaptersReadJSON(t, connection)
	assertEqual(t, response["id"].(float64), requestID)
	result := response["result"].(map[string]any)
	data := result["data"].([]any)
	assertEqual(t, len(data), 0)
	runtimeAdaptersRequireEventually(t, func() bool {
		return !sharedKeepalive.Active()
	})
}

func TestRuntimeAdaptersCloseMarksCodexProxyStopped(t *testing.T) {
	rawServer := startRuntimeAdaptersSimulatedCodexServer(t)
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-runtime-adapters-codex-close-test",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{
			supervision.ComponentCodexProxy,
			supervision.ComponentRuntimeAgentEndpoint,
		},
	)
	requireNoError(t, err)
	adapters, err := StartRuntimeAdapters(
		runtimeAdaptersCodexRuntimePlan("ws"+rawServer.URL[len("http"):]+"/raw"),
		supervisorHandle,
		keepalive.NewSharedManager(),
		runtimeAdaptersTestOptions(t),
	)
	requireNoError(t, err)
	waitForComponentState(t, supervisorHandle, supervision.ComponentCodexProxy, supervision.ComponentHealthy)

	adapters.Close()

	snapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentCodexProxy)
	if snapshot == nil {
		t.Fatalf("expected Codex proxy component snapshot")
	}
	assertEqual(t, snapshot.State, supervision.ComponentStopped)
}

func TestStartRuntimeAdaptersStartsOpenCodeProxyFromDedicatedRuntimeEndpoint(t *testing.T) {
	simulatedOpenCodeServer := startRuntimeAdaptersSimulatedOpenCodeServer(t)
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-runtime-adapters-test",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{
			supervision.ComponentOpenCodeProxy,
			supervision.ComponentOpenCodeProxyConnectivity,
			supervision.ComponentRuntimeAgentEndpoint,
		},
	)
	requireNoError(t, err)

	adapters, err := StartRuntimeAdapters(
		runtimeAdaptersOpenCodeRuntimePlan(simulatedOpenCodeServer.URL+"/global/health"),
		supervisorHandle,
		keepalive.NewSharedManager(),
		runtimeAdaptersTestOptions(t),
	)

	requireNoError(t, err)
	defer adapters.Close()
	proxySnapshot := waitForComponentState(
		t,
		supervisorHandle,
		supervision.ComponentOpenCodeProxy,
		supervision.ComponentHealthy,
	)
	assertEqual(t, proxySnapshot.Details["rawTarget"], simulatedOpenCodeServer.URL)
	waitForComponentState(
		t,
		supervisorHandle,
		supervision.ComponentRuntimeAgentEndpoint,
		supervision.ComponentHealthy,
	)
	connectivitySnapshot := waitForComponentState(
		t,
		supervisorHandle,
		supervision.ComponentOpenCodeProxyConnectivity,
		supervision.ComponentHealthy,
	)
	assertEqual(t, connectivitySnapshot.Details["observedStatus"], "204")
}

func TestStartRuntimeAdaptersUsesConfiguredIdempotencyStoreForOpenCodeProxy(t *testing.T) {
	storeRoot := t.TempDir()
	simulatedOpenCodeServer := startRuntimeAdaptersOpenCodeSessionServer(t)
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-runtime-adapters-store-test",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{
			supervision.ComponentOpenCodeProxy,
			supervision.ComponentOpenCodeProxyConnectivity,
			supervision.ComponentRuntimeAgentEndpoint,
		},
	)
	requireNoError(t, err)
	adapters, err := StartRuntimeAdapters(
		runtimeAdaptersOpenCodeRuntimePlan(simulatedOpenCodeServer.URL+"/global/health"),
		supervisorHandle,
		keepalive.NewSharedManager(),
		RuntimeAdapterOptions{IdempotencyStoreRoot: storeRoot},
	)
	requireNoError(t, err)
	defer adapters.Close()
	if len(adapters.openCodeProxies) != 1 {
		t.Fatalf("expected one OpenCode proxy handle, got %d", len(adapters.openCodeProxies))
	}
	connection := runtimeAdaptersDialWebSocket(t, adapters.openCodeProxies[0].ListenURL())
	defer connection.CloseNow()
	fingerprint := runtimeAdaptersOpenCodeCreateFingerprint(t, "/workspace")

	runtimeAdaptersWriteJSON(t, connection, map[string]any{
		"id":     "create",
		"method": http.MethodPost,
		"path":   "/session",
		"body": map[string]any{
			"directory": "/workspace",
		},
		"idempotency": map[string]any{
			"key":                "delivery-key",
			"operation":          "createConversation",
			"requestFingerprint": fingerprint.Value(),
		},
	})
	response := runtimeAdaptersReadJSON(t, connection)
	if response["status"] != float64(http.StatusOK) {
		t.Fatalf("expected OpenCode create session status %d, got %#v", http.StatusOK, response["status"])
	}

	store, err := idempotency.LoadStore(storeRoot)
	requireNoError(t, err)
	record, err := store.GetByKey(idempotency.AgentRuntimeOpenCode, idempotency.IdempotencyOperationCreateConversation, "delivery-key")
	requireNoError(t, err)
	assertEqual(t, record.Status, idempotency.IdempotencyRecordCompleted)
	if record.ProviderConversationID == nil {
		t.Fatalf("expected provider conversation id to be persisted")
	}
	assertEqual(t, *record.ProviderConversationID, "session_created")
}

func TestStartRuntimeAdaptersNotifiesObserverAroundStartedAdapter(t *testing.T) {
	simulatedOpenCodeServer := startRuntimeAdaptersSimulatedOpenCodeServer(t)
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-runtime-adapters-observer-test",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{
			supervision.ComponentOpenCodeProxy,
			supervision.ComponentOpenCodeProxyConnectivity,
			supervision.ComponentRuntimeAgentEndpoint,
		},
	)
	requireNoError(t, err)
	observer := &recordingRuntimeAdapterLifecycleObserver{}

	adapters, err := StartRuntimeAdaptersWithObserver(
		runtimeAdaptersOpenCodeRuntimePlan(simulatedOpenCodeServer.URL+"/global/health"),
		supervisorHandle,
		keepalive.NewSharedManager(),
		runtimeAdaptersTestOptions(t),
		observer,
	)

	requireNoError(t, err)
	defer adapters.Close()
	assertRuntimeAdapterObserverEvents(t, observer.events, []string{
		"start:opencode",
		"complete:opencode",
	})
}

func TestStartRuntimeAdaptersStartsPiProxyFromDedicatedRuntimeEndpoint(t *testing.T) {
	cliPath := writeRuntimeAdaptersSimulatedPiCLI(t)
	sessionDir := t.TempDir()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-runtime-adapters-pi-test",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{
			supervision.ComponentPiProxy,
			supervision.ComponentPiRpcProcess,
			supervision.ComponentPiProxyConnectivity,
			supervision.ComponentRuntimeAgentEndpoint,
		},
	)
	requireNoError(t, err)

	adapters, err := StartRuntimeAdapters(
		runtimeAdaptersPiRuntimePlan(cliPath, sessionDir),
		supervisorHandle,
		keepalive.NewSharedManager(),
		runtimeAdaptersTestOptions(t),
	)

	requireNoError(t, err)
	defer adapters.Close()
	waitForComponentState(
		t,
		supervisorHandle,
		supervision.ComponentPiProxy,
		supervision.ComponentHealthy,
	)
	waitForComponentState(
		t,
		supervisorHandle,
		supervision.ComponentRuntimeAgentEndpoint,
		supervision.ComponentHealthy,
	)
	connectivitySnapshot := waitForComponentState(
		t,
		supervisorHandle,
		supervision.ComponentPiProxyConnectivity,
		supervision.ComponentHealthy,
	)
	assertEqual(t, connectivitySnapshot.Details["connectivityState"], "Connected")
	waitForComponentState(
		t,
		supervisorHandle,
		supervision.ComponentPiRpcProcess,
		supervision.ComponentHealthy,
	)
}

func TestStartRuntimeAdaptersScopesPiProxyRPCProcess(t *testing.T) {
	cliPath := writeRuntimeAdaptersSimulatedPiCLI(t)
	sessionDir := t.TempDir()
	registry := &process.PlatformProcessRegistry{}
	cgroupRoot := t.TempDir()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-runtime-adapters-pi-scope-test",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{
			supervision.ComponentPiProxy,
			supervision.ComponentPiRpcProcess,
			supervision.ComponentPiProxyConnectivity,
			supervision.ComponentRuntimeAgentEndpoint,
		},
	)
	requireNoError(t, err)

	adapters, err := StartRuntimeAdapters(
		runtimeAdaptersPiRuntimePlan(cliPath, sessionDir),
		supervisorHandle,
		keepalive.NewSharedManager(),
		RuntimeAdapterOptions{
			IdempotencyStoreRoot: t.TempDir(),
			PlatformScopeInput: &RuntimeAdapterPlatformScopeInput{
				CgroupRoot:        cgroupRoot,
				SandboxInstanceID: "sbi_pi_scope",
				Registry:          registry,
			},
		},
	)

	requireNoError(t, err)
	waitForComponentState(t, supervisorHandle, supervision.ComponentPiProxyConnectivity, supervision.ComponentHealthy)
	snapshot := requireOnlyRuntimeAdapterPlatformScopeSnapshot(t, registry)
	assertEqual(t, snapshot.ProcessKey, "pi-rpc")
	assertRuntimeAdaptersFileText(t, snapshot.ScopePaths.ProcsFile, strconv.Itoa(int(snapshot.SupervisedRootPID))+"\n")

	adapters.Close()
	assertRuntimeAdaptersFileText(t, snapshot.ScopePaths.KillFile, "1\n")
	snapshots, err := registry.Snapshots()
	requireNoError(t, err)
	assertEqual(t, len(snapshots), 0)
}

func TestStartRuntimeAdaptersOwnsEveryStartedRuntimeAdapter(t *testing.T) {
	simulatedOpenCodeServer := startRuntimeAdaptersSimulatedOpenCodeServer(t)
	cliPath := writeRuntimeAdaptersSimulatedPiCLI(t)
	sessionDir := t.TempDir()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-runtime-adapters-mixed-test",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{
			supervision.ComponentOpenCodeProxy,
			supervision.ComponentOpenCodeProxyConnectivity,
			supervision.ComponentPiProxy,
			supervision.ComponentPiRpcProcess,
			supervision.ComponentPiProxyConnectivity,
			supervision.ComponentRuntimeAgentEndpoint,
		},
	)
	requireNoError(t, err)
	runtimePlan := runtimeAdaptersOpenCodeRuntimePlan(simulatedOpenCodeServer.URL + "/global/health")
	piRuntimePlan := runtimeAdaptersPiRuntimePlan(cliPath, sessionDir)
	runtimePlan.RuntimeClients = append(runtimePlan.RuntimeClients, piRuntimePlan.RuntimeClients...)
	runtimePlan.AgentRuntimes = append(runtimePlan.AgentRuntimes, piRuntimePlan.AgentRuntimes...)

	adapters, err := StartRuntimeAdapters(
		runtimePlan,
		supervisorHandle,
		keepalive.NewSharedManager(),
		runtimeAdaptersTestOptions(t),
	)

	requireNoError(t, err)
	defer adapters.Close()
	assertEqual(t, len(adapters.openCodeProxies), 1)
	assertEqual(t, len(adapters.piProxies), 1)
	assertEqual(t, len(adapters.runtimeAgentProbes), 2)
	waitForComponentState(t, supervisorHandle, supervision.ComponentOpenCodeProxy, supervision.ComponentHealthy)
	waitForComponentState(t, supervisorHandle, supervision.ComponentPiProxy, supervision.ComponentHealthy)
	_, endpointErr := adapters.AgentEndpointURL()
	if endpointErr == nil {
		t.Fatalf("expected mixed runtime adapters to reject ambiguous agent endpoint attachment")
	}
	assertEqual(t, endpointErr.Error(), "sandboxd currently supports exactly one runtime adapter endpoint")
}

func TestStartRuntimeAdaptersReturnsRuntimeAttributedError(t *testing.T) {
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-runtime-adapters-attribution-test",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{supervision.ComponentOpenCodeProxy},
	)
	requireNoError(t, err)
	runtimePlan := runtimeAdaptersOpenCodeRuntimePlan("http://127.0.0.1:4096/not-health")

	_, err = StartRuntimeAdapters(
		runtimePlan,
		supervisorHandle,
		keepalive.NewSharedManager(),
		runtimeAdaptersTestOptions(t),
	)

	var adapterErr *RuntimeAdapterError
	if !errors.As(err, &adapterErr) {
		t.Fatalf("expected runtime adapter attribution error, got %#v", err)
	}
	assertEqual(t, adapterErr.RuntimeID, "opencode")
}

func TestStartRuntimeAdaptersRejectsUnsupportedRuntimeID(t *testing.T) {
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-runtime-adapters-unsupported-test",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{supervision.ComponentRuntimeAgentEndpoint},
	)
	requireNoError(t, err)
	runtimePlan := runtimeAdaptersRuntimePlanWithAgentRuntimes([]runtime.CompiledAgentRuntime{
		{
			RuntimeID:   "unknown-runtime",
			RuntimeKey:  "runtime-process",
			ClientID:    "runtime-client",
			EndpointKey: "app-server",
			PTYLaunch:   json.RawMessage(`{}`),
		},
	})

	_, err = StartRuntimeAdapters(
		runtimePlan,
		supervisorHandle,
		keepalive.NewSharedManager(),
		runtimeAdaptersTestOptions(t),
	)

	var adapterErr *RuntimeAdapterError
	if !errors.As(err, &adapterErr) {
		t.Fatalf("expected runtime adapter attribution error, got %#v", err)
	}
	assertEqual(t, adapterErr.RuntimeID, "unknown-runtime")
	assertEqual(t, adapterErr.Error(), `sandboxd has no platform-activity adapter for runtime "unknown-runtime"`)
}

func TestStartRuntimeAdaptersRejectsDuplicateRuntimeIDs(t *testing.T) {
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-runtime-adapters-duplicate-test",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{supervision.ComponentRuntimeAgentEndpoint},
	)
	requireNoError(t, err)
	runtimePlan := runtimeAdaptersRuntimePlanWithAgentRuntimes([]runtime.CompiledAgentRuntime{
		{
			RuntimeID:   "opencode",
			RuntimeKey:  "opencode-server",
			ClientID:    "opencode-cli",
			EndpointKey: "server",
			PTYLaunch:   json.RawMessage(`{}`),
		},
		{
			RuntimeID:   "opencode",
			RuntimeKey:  "opencode-server",
			ClientID:    "opencode-cli",
			EndpointKey: "server",
			PTYLaunch:   json.RawMessage(`{}`),
		},
	})

	_, err = StartRuntimeAdapters(
		runtimePlan,
		supervisorHandle,
		keepalive.NewSharedManager(),
		runtimeAdaptersTestOptions(t),
	)

	var adapterErr *RuntimeAdapterError
	if !errors.As(err, &adapterErr) {
		t.Fatalf("expected runtime adapter attribution error, got %#v", err)
	}
	assertEqual(t, adapterErr.RuntimeID, "opencode")
	assertEqual(t, adapterErr.Error(), `runtime plan declared duplicate agent runtime id "opencode"`)
}

func startRuntimeAdaptersSimulatedCodexServer(t *testing.T) *httptest.Server {
	t.Helper()
	sendIdleStatus := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(writer, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		ctx := request.Context()
		readCtx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
		_, payload, err := connection.Read(readCtx)
		cancel()
		if err != nil {
			return
		}
		var message map[string]any
		if err := json.Unmarshal(payload, &message); err != nil {
			t.Errorf("expected Codex raw request JSON: %v", err)
			return
		}
		if isRuntimeAdaptersCodexSessionManagerInitialize(message) {
			runtimeAdaptersHandleCodexSessionManager(t, ctx, connection, message, sendIdleStatus)
			return
		}
		writeCodexProxyTestJSON(t, connection, map[string]any{
			"id": message["id"],
			"result": map[string]any{
				"data": []any{},
			},
		})
		close(sendIdleStatus)
		<-ctx.Done()
	}))
	t.Cleanup(server.Close)
	return server
}

func runtimeAdaptersHandleCodexSessionManager(
	t *testing.T,
	ctx context.Context,
	connection *websocket.Conn,
	initializeMessage map[string]any,
	sendIdleStatus <-chan struct{},
) {
	t.Helper()
	writeCodexProxyTestJSON(t, connection, map[string]any{
		"id":     initializeMessage["id"],
		"result": map[string]any{},
	})
	runtimeAdaptersReadJSON(t, connection)
	listRequest := runtimeAdaptersReadJSON(t, connection)
	assertEqual(t, listRequest["method"], "thread/loaded/list")
	writeCodexProxyTestJSON(t, connection, map[string]any{
		"id": listRequest["id"],
		"result": map[string]any{
			"data":       []any{"thr_123"},
			"nextCursor": nil,
		},
	})
	readRequest := runtimeAdaptersReadJSON(t, connection)
	assertEqual(t, readRequest["method"], "thread/read")
	writeCodexProxyTestJSON(t, connection, map[string]any{
		"id": readRequest["id"],
		"result": map[string]any{
			"thread": map[string]any{
				"id": "thr_123",
				"status": map[string]any{
					"type":        "active",
					"activeFlags": []any{},
				},
			},
		},
	})
	select {
	case <-sendIdleStatus:
		writeCodexProxyTestJSON(t, connection, map[string]any{
			"method": "thread/status/changed",
			"params": map[string]any{
				"threadId": "thr_123",
				"status": map[string]any{
					"type": "idle",
				},
			},
		})
	case <-ctx.Done():
	}
}

func isRuntimeAdaptersCodexSessionManagerInitialize(message map[string]any) bool {
	return message["method"] == "initialize" && message["id"] == float64(1)
}

// startRuntimeAdaptersSimulatedOpenCodeServer models the OpenCode raw HTTP
// server routes sandboxd consumes during adapter startup and health probing.
func startRuntimeAdaptersSimulatedOpenCodeServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/global/health":
			writer.WriteHeader(http.StatusNoContent)
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			if flusher, ok := writer.(http.Flusher); ok {
				flusher.Flush()
			}
			<-request.Context().Done()
		default:
			http.NotFound(writer, request)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func startRuntimeAdaptersOpenCodeSessionServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/global/health":
			writer.WriteHeader(http.StatusNoContent)
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			if flusher, ok := writer.(http.Flusher); ok {
				flusher.Flush()
			}
			<-request.Context().Done()
		case "/session":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{"id":"session_created","title":"Created"}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func runtimeAdaptersRuntimePlanWithAgentRuntimes(agentRuntimes []runtime.CompiledAgentRuntime) runtime.CompiledRuntimePlan {
	return runtime.CompiledRuntimePlan{
		SandboxProfileID: "profile_runtime_adapters",
		Version:          7,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   runtime.CompiledRuntimePlanImageSnapshot,
			ImageRef: "mistle-runtime-adapters-test",
		},
		AgentRuntimes: agentRuntimes,
	}
}

func runtimeAdaptersCodexRuntimePlan(rawURL string) runtime.CompiledRuntimePlan {
	return runtime.CompiledRuntimePlan{
		SandboxProfileID: "profile_runtime_adapters_codex",
		Version:          7,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   runtime.CompiledRuntimePlanImageSnapshot,
			ImageRef: "mistle-runtime-adapters-codex-test",
		},
		RuntimeClients: []runtime.RuntimeClient{
			{
				ClientID: "codex-client",
				Processes: []runtime.RuntimeClientProcess{
					{
						ProcessKey: "codex-app-server",
						Readiness: runtime.RuntimeClientProcessReadiness{
							Type: runtime.RuntimeClientProcessReadinessWS,
							URL:  rawURL,
						},
					},
				},
				Endpoints: []runtime.RuntimeClientEndpoint{
					{
						EndpointKey:    "codex",
						ProcessKey:     runtimeAdaptersStringPointer("codex-app-server"),
						ConnectionMode: "dedicated",
						Transport: runtime.RuntimeClientEndpointTransport{
							Type: "ws",
							URL:  "ws://127.0.0.1:0/codex",
						},
					},
				},
			},
		},
		AgentRuntimes: []runtime.CompiledAgentRuntime{
			{
				RuntimeID:   "codex",
				RuntimeKey:  "codex-app-server",
				ClientID:    "codex-client",
				EndpointKey: "codex",
			},
		},
	}
}

func runtimeAdaptersOpenCodeRuntimePlan(readinessURL string) runtime.CompiledRuntimePlan {
	return runtime.CompiledRuntimePlan{
		SandboxProfileID: "profile_runtime_adapters",
		Version:          7,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   runtime.CompiledRuntimePlanImageSnapshot,
			ImageRef: "mistle-runtime-adapters-test",
		},
		RuntimeClients: []runtime.RuntimeClient{
			{
				ClientID: "opencode-client",
				Processes: []runtime.RuntimeClientProcess{
					{
						ProcessKey: "opencode-server",
						Readiness: runtime.RuntimeClientProcessReadiness{
							Type:           runtime.RuntimeClientProcessReadinessHTTP,
							URL:            readinessURL,
							ExpectedStatus: uint16(http.StatusNoContent),
						},
					},
				},
				Endpoints: []runtime.RuntimeClientEndpoint{
					{
						EndpointKey:    "opencode",
						ProcessKey:     runtimeAdaptersStringPointer("opencode-server"),
						ConnectionMode: "dedicated",
						Transport: runtime.RuntimeClientEndpointTransport{
							Type: "ws",
							URL:  "ws://127.0.0.1:0/opencode",
						},
					},
				},
			},
		},
		AgentRuntimes: []runtime.CompiledAgentRuntime{
			{
				RuntimeID:   "opencode",
				RuntimeKey:  "opencode-server",
				ClientID:    "opencode-client",
				EndpointKey: "opencode",
			},
		},
	}
}

func runtimeAdaptersPiRuntimePlan(cliPath string, sessionDir string) runtime.CompiledRuntimePlan {
	return runtime.CompiledRuntimePlan{
		SandboxProfileID: "profile_runtime_adapters_pi",
		Version:          7,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   runtime.CompiledRuntimePlanImageSnapshot,
			ImageRef: "mistle-runtime-adapters-pi-test",
		},
		RuntimeClients: []runtime.RuntimeClient{
			{
				ClientID: "pi-client",
				Setup: runtime.RuntimeClientSetup{
					Env: map[string]string{
						"MISTLE_PI_CLI_PATH":    cliPath,
						piproxy.PiSessionDirEnv: sessionDir,
					},
				},
				Endpoints: []runtime.RuntimeClientEndpoint{
					{
						EndpointKey:    "pi",
						ConnectionMode: "dedicated",
						Transport: runtime.RuntimeClientEndpointTransport{
							Type: "ws",
							URL:  "ws://127.0.0.1:0/pi",
						},
					},
				},
			},
		},
		AgentRuntimes: []runtime.CompiledAgentRuntime{
			{
				RuntimeID:   "pi",
				RuntimeKey:  "pi-rpc",
				ClientID:    "pi-client",
				EndpointKey: "pi",
			},
		},
	}
}

func writeRuntimeAdaptersSimulatedPiCLI(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "pi-cli")
	script := `#!/bin/sh
exec python3 -c '
import json
import os
import sys
session_dir = sys.argv[1]
session_file = os.path.join(session_dir, "session_123.jsonl")
os.makedirs(session_dir, exist_ok=True)
for line in sys.stdin:
    command = json.loads(line)
    print(json.dumps({
        "type": "response",
        "id": command["id"],
        "command": command.get("type"),
        "success": True,
        "data": {
            "sessionId": "pi_session_123",
            "sessionFile": session_file,
            "isStreaming": False,
            "isCompacting": False,
            "pendingMessageCount": 0,
        },
    }), flush=True)
' "$PI_CODING_AGENT_SESSION_DIR"
`
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatalf("expected simulated Pi CLI to be written: %v", err)
	}
	return path
}

func runtimeAdaptersStringPointer(value string) *string {
	return &value
}

func runtimeAdaptersTestOptions(t *testing.T) RuntimeAdapterOptions {
	t.Helper()
	return RuntimeAdapterOptions{IdempotencyStoreRoot: t.TempDir()}
}

func runtimeAdaptersDialWebSocket(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, url, nil)
	requireNoError(t, err)
	return connection
}

func runtimeAdaptersWriteJSON(t *testing.T, connection *websocket.Conn, value any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	serialized, err := json.Marshal(value)
	requireNoError(t, err)
	requireNoError(t, connection.Write(ctx, websocket.MessageText, serialized))
}

func runtimeAdaptersReadJSON(t *testing.T, connection *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, payload, err := connection.Read(ctx)
	requireNoError(t, err)
	var decoded map[string]any
	requireNoError(t, json.Unmarshal(payload, &decoded))
	return decoded
}

func runtimeAdaptersRequireEventually(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("condition was not satisfied before deadline")
}

func runtimeAdaptersOpenCodeCreateFingerprint(t *testing.T, directory string) idempotency.RequestFingerprint {
	t.Helper()
	fingerprint, err := idempotency.RequestFingerprintFromFields(idempotency.AgentRuntimeOpenCode, idempotency.IdempotencyOperationCreateConversation, map[string]any{
		"directory": directory,
	})
	requireNoError(t, err)
	return fingerprint
}

func requireOnlyRuntimeAdapterPlatformScopeSnapshot(t *testing.T, registry *process.PlatformProcessRegistry) process.PlatformProcessScopeSnapshot {
	t.Helper()
	snapshots, err := registry.Snapshots()
	requireNoError(t, err)
	if len(snapshots) != 1 {
		t.Fatalf("expected one platform scope snapshot, got %#v", snapshots)
	}
	return snapshots[0]
}

func assertRuntimeAdaptersFileText(t *testing.T, path string, expected string) {
	t.Helper()
	content, err := os.ReadFile(path)
	requireNoError(t, err)
	if string(content) != expected {
		t.Fatalf("expected %s to contain %q, got %q", path, expected, string(content))
	}
}

type recordingRuntimeAdapterLifecycleObserver struct {
	events []string
}

func (observer *recordingRuntimeAdapterLifecycleObserver) RecordAdapterStarted(runtimeID string) {
	observer.events = append(observer.events, "start:"+runtimeID)
}

func (observer *recordingRuntimeAdapterLifecycleObserver) RecordAdapterCompleted(runtimeID string) {
	observer.events = append(observer.events, "complete:"+runtimeID)
}

func assertRuntimeAdapterObserverEvents(t *testing.T, actual []string, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("expected observer events %v, got %v", expected, actual)
	}
	for index, expectedValue := range expected {
		if actual[index] != expectedValue {
			t.Fatalf("expected observer events %v, got %v", expected, actual)
		}
	}
}
