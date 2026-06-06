package sandboxdstate

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestWebSocketHandshakeProbeSucceedsWhenEndpointAcceptsConnections(t *testing.T) {
	server := startWebSocketServer(t, func(connection *websocket.Conn) {})
	defer server.Close()

	requireNoError(t, CheckWebSocketHandshake(webSocketURL(server)))
}

func TestRuntimeAgentProbeLoopMarksAgentEndpointHealthyAfterHandshake(t *testing.T) {
	server := startWebSocketServer(t, func(connection *websocket.Conn) {})
	defer server.Close()
	supervisorHandle := newProbeSupervisor(t, []supervision.SupervisedComponent{
		supervision.ComponentRuntimeAgentEndpoint,
	})

	probeHandle, err := StartRuntimeAgentProbe(RuntimeAgentProbePlan{
		AgentEndpointURL: webSocketURL(server),
		RuntimeProbe:     CodexRuntimeProbe{},
	}, supervisorHandle, timeutil.ThreadSleeper{})
	requireNoError(t, err)
	defer probeHandle.Close()

	snapshot := waitForComponentState(t, supervisorHandle, supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentHealthy)
	assertEqual(t, snapshot.Details["endpointUrl"], webSocketURL(server))
	assertEqual(t, snapshot.Details["connectivityState"], "Connected")
}

func TestRuntimeAgentProbeLoopMarksAgentEndpointRestartingWhenDialFails(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	url := "ws://" + listener.Addr().String()
	requireNoError(t, listener.Close())
	supervisorHandle := newProbeSupervisor(t, []supervision.SupervisedComponent{
		supervision.ComponentRuntimeAgentEndpoint,
	})

	probeHandle, err := StartRuntimeAgentProbe(RuntimeAgentProbePlan{
		AgentEndpointURL: url,
		RuntimeProbe:     CodexRuntimeProbe{},
	}, supervisorHandle, timeutil.ThreadSleeper{})
	requireNoError(t, err)
	defer probeHandle.Close()

	snapshot := waitForComponentState(t, supervisorHandle, supervision.ComponentRuntimeAgentEndpoint, supervision.ComponentRestarting)
	assertEqual(t, snapshot.Details["endpointUrl"], url)
	assertEqual(t, snapshot.Details["connectivityState"], "Disconnected")
	if snapshot.Details["lastProbeError"] == "" {
		t.Fatalf("expected failed probe to record lastProbeError")
	}
}

func TestOpenCodeProxyConnectivityProbeRequiresExpectedHealthStatus(t *testing.T) {
	server := startWebSocketServer(t, func(connection *websocket.Conn) {
		request := readWebSocketJSON(t, connection)
		assertEqual(t, request["id"].(string), "sandboxd-opencode-health")
		assertEqual(t, request["method"].(string), http.MethodGet)
		assertEqual(t, request["path"].(string), "/global/health")
		writeWebSocketJSON(t, connection, map[string]any{
			"id":      "sandboxd-opencode-health",
			"type":    "response",
			"status":  float64(204),
			"headers": map[string]any{},
			"body":    "",
		})
	})
	defer server.Close()

	observedStatus, err := CheckOpenCodeProxyConnectivity(webSocketURL(server), "/global/health", 204)
	requireNoError(t, err)

	assertEqual(t, observedStatus, uint16(204))
}

func TestOpenCodeProxyConnectivityProbeFailsOnUnexpectedHealthStatus(t *testing.T) {
	server := startWebSocketServer(t, func(connection *websocket.Conn) {
		_ = readWebSocketJSON(t, connection)
		writeWebSocketJSON(t, connection, map[string]any{
			"id":     "sandboxd-opencode-health",
			"type":   "response",
			"status": float64(500),
		})
	})
	defer server.Close()

	_, err := CheckOpenCodeProxyConnectivity(webSocketURL(server), "/global/health", 204)
	if err == nil {
		t.Fatalf("expected unexpected OpenCode health status to fail")
	}
	if !strings.Contains(err.Error(), "expected 204") {
		t.Fatalf("expected status mismatch error, got %v", err)
	}
}

func TestPiProxyConnectivityProbeAcceptsSuccessfulGetStateResponse(t *testing.T) {
	server := startWebSocketServer(t, func(connection *websocket.Conn) {
		request := readWebSocketJSON(t, connection)
		assertEqual(t, request["method"].(string), "pi/getState")
		writeWebSocketJSON(t, connection, map[string]any{
			"jsonrpc": "2.0",
			"id":      "sandboxd-pi-health",
			"result": map[string]any{
				"sessionFile": "/tmp/session.json",
			},
		})
	})
	defer server.Close()

	requireNoError(t, CheckPiProxyConnectivity(webSocketURL(server)))
}

func TestPiProxyConnectivityProbeIgnoresNotificationsBeforeGetStateResponse(t *testing.T) {
	server := startWebSocketServer(t, func(connection *websocket.Conn) {
		_ = readWebSocketJSON(t, connection)
		writeWebSocketJSON(t, connection, map[string]any{
			"jsonrpc": "2.0",
			"method":  "pi/event",
			"params": map[string]any{
				"type":    "message",
				"message": "queued event",
			},
		})
		writeWebSocketJSON(t, connection, map[string]any{
			"jsonrpc": "2.0",
			"id":      "sandboxd-pi-health",
			"result": map[string]any{
				"sessionFile": "/tmp/session.json",
			},
		})
	})
	defer server.Close()

	requireNoError(t, CheckPiProxyConnectivity(webSocketURL(server)))
}

func TestPiProxyConnectivityProbeRejectsErrorResponse(t *testing.T) {
	server := startWebSocketServer(t, func(connection *websocket.Conn) {
		_ = readWebSocketJSON(t, connection)
		writeWebSocketJSON(t, connection, map[string]any{
			"jsonrpc": "2.0",
			"id":      "sandboxd-pi-health",
			"error": map[string]any{
				"code":    float64(-32000),
				"message": "not ready",
			},
		})
	})
	defer server.Close()

	err := CheckPiProxyConnectivity(webSocketURL(server))
	if err == nil {
		t.Fatalf("expected Pi JSON-RPC error response to fail")
	}
	if !strings.Contains(err.Error(), "error response") {
		t.Fatalf("expected error response failure, got %v", err)
	}
}

func startWebSocketServer(t *testing.T, handler func(*websocket.Conn)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(writer, request, nil)
		if err != nil {
			t.Errorf("expected websocket accept to succeed, got %v", err)
			return
		}
		defer connection.Close(websocket.StatusNormalClosure, "")
		handler(connection)
	}))
}

func webSocketURL(server *httptest.Server) string {
	return "ws" + strings.TrimPrefix(server.URL, "http")
}

func readWebSocketJSON(t *testing.T, connection *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	messageType, payload, err := connection.Read(ctx)
	requireNoError(t, err)
	assertEqual(t, messageType, websocket.MessageText)

	var decoded map[string]any
	requireNoError(t, json.Unmarshal(payload, &decoded))
	return decoded
}

func writeWebSocketJSON(t *testing.T, connection *websocket.Conn, payload map[string]any) {
	t.Helper()
	serialized, err := json.Marshal(payload)
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	requireNoError(t, connection.Write(ctx, websocket.MessageText, serialized))
}

func newProbeSupervisor(t *testing.T, components []supervision.SupervisedComponent) *supervision.SandboxdSupervisorHandle {
	t.Helper()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle("sandbox-probe", timeutil.NewMutableClock(1_000), components)
	requireNoError(t, err)
	return supervisorHandle
}

func waitForComponentState(
	t *testing.T,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	component supervision.SupervisedComponent,
	expectedState supervision.ComponentHealthState,
) supervision.ComponentHealthSnapshot {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		snapshot := supervisorHandle.ComponentSnapshot(component)
		if snapshot != nil && snapshot.State == expectedState {
			return *snapshot
		}
		time.Sleep(10 * time.Millisecond)
	}
	snapshot := supervisorHandle.ComponentSnapshot(component)
	t.Fatalf("component %s did not reach %s, last snapshot %#v", component, expectedState, snapshot)
	return supervision.ComponentHealthSnapshot{}
}
