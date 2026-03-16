package tunnel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

func TestCodexExecutionLeaseObserverCreatesAndRenewsLease(t *testing.T) {
	clientTunnelConn, serverTunnelConn := createWebSocketPair(t)
	defer clientTunnelConn.CloseNow()
	defer serverTunnelConn.CloseNow()

	executionLeases := newExecutionLeaseEngine()
	executionLeases.AttachTunnelConnection(clientTunnelConn)

	threadID := "thr_123"
	turnID := "turn_123"

	server := newCodexLeaseTestServer(t, []codexLeaseTestSessionScript{
		func(ctx context.Context, conn *websocket.Conn) {
			completeCodexInitializeHandshake(t, ctx, conn)
			expectCodexMethodAndRespond(t, ctx, conn, "thread/read", map[string]any{
				"thread": map[string]any{
					"id": threadID,
					"turns": []map[string]any{
						{
							"id":     turnID,
							"status": "inProgress",
						},
					},
				},
			})
		},
		func(ctx context.Context, conn *websocket.Conn) {
			completeCodexInitializeHandshake(t, ctx, conn)
			expectCodexMethodAndRespond(t, ctx, conn, "thread/read", map[string]any{
				"thread": map[string]any{
					"id": threadID,
					"turns": []map[string]any{
						{
							"id":     turnID,
							"status": "completed",
						},
					},
				},
			})
		},
	})
	defer server.Close()

	observer := newCodexExecutionLeaseObserver(codexExecutionLeaseObserverInput{
		Context:         context.Background(),
		TransportURL:    "ws" + strings.TrimPrefix(server.URL, "http"),
		ExecutionLeases: executionLeases,
		PollInterval:    50 * time.Millisecond,
	})

	observer.ObserveClientMessage([]byte(`{"id":"1","method":"turn/start","params":{"threadId":"thr_123","input":[]}}`))
	observer.ObserveAgentMessage([]byte(`{"id":"1","result":{"turn":{"id":"turn_123","status":"inProgress"}}}`))
	observer.HandleStreamDisconnected()

	leaseID := newCodexExecutionLeaseID(threadID, turnID)

	waitForCondition(t, 2*time.Second, func() bool {
		return executionLeases.Has(leaseID)
	})

	waitForCondition(t, 2*time.Second, func() bool {
		return !executionLeases.Has(leaseID)
	})
}

func TestCodexExecutionLeaseObserverResumesNotLoadedThreads(t *testing.T) {
	clientTunnelConn, serverTunnelConn := createWebSocketPair(t)
	defer clientTunnelConn.CloseNow()
	defer serverTunnelConn.CloseNow()

	executionLeases := newExecutionLeaseEngine()
	executionLeases.AttachTunnelConnection(clientTunnelConn)

	threadID := "thr_resume"
	turnID := "turn_resume"

	server := newCodexLeaseTestServer(t, []codexLeaseTestSessionScript{
		func(ctx context.Context, conn *websocket.Conn) {
			completeCodexInitializeHandshake(t, ctx, conn)
			expectCodexMethodAndRespondError(t, ctx, conn, "thread/read", -32600, "thread not loaded: thr_resume")
			expectCodexMethodAndRespond(t, ctx, conn, "thread/resume", map[string]any{
				"thread": map[string]any{
					"id": threadID,
				},
			})
			expectCodexMethodAndRespond(t, ctx, conn, "thread/read", map[string]any{
				"thread": map[string]any{
					"id": threadID,
					"turns": []map[string]any{
						{
							"id":     turnID,
							"status": "inProgress",
						},
					},
				},
			})
		},
		func(ctx context.Context, conn *websocket.Conn) {
			completeCodexInitializeHandshake(t, ctx, conn)
			expectCodexMethodAndRespond(t, ctx, conn, "thread/read", map[string]any{
				"thread": map[string]any{
					"id": threadID,
					"turns": []map[string]any{
						{
							"id":     turnID,
							"status": "completed",
						},
					},
				},
			})
		},
	})
	defer server.Close()

	observer := newCodexExecutionLeaseObserver(codexExecutionLeaseObserverInput{
		Context:         context.Background(),
		TransportURL:    "ws" + strings.TrimPrefix(server.URL, "http"),
		ExecutionLeases: executionLeases,
		PollInterval:    50 * time.Millisecond,
	})

	observer.ObserveClientMessage([]byte(`{"id":"1","method":"turn/start","params":{"threadId":"thr_resume","input":[]}}`))
	observer.ObserveAgentMessage([]byte(`{"id":"1","result":{"turn":{"id":"turn_resume","status":"inProgress"}}}`))
	observer.HandleStreamDisconnected()

	leaseID := newCodexExecutionLeaseID(threadID, turnID)

	waitForCondition(t, 2*time.Second, func() bool {
		return executionLeases.Has(leaseID)
	})

	waitForCondition(t, 2*time.Second, func() bool {
		return !executionLeases.Has(leaseID)
	})
}

func TestNewAgentExecutionLeaseObserverReturnsNilForUnknownRuntime(t *testing.T) {
	observer := newAgentExecutionLeaseObserver(agentExecutionLeaseObserverInput{
		Context: context.Background(),
		AgentRuntime: startup.AgentRuntime{
			RuntimeKey: "other-runtime",
		},
		TransportURL:    "ws://127.0.0.1:4500",
		ExecutionLeases: newExecutionLeaseEngine(),
	})

	if observer != nil {
		t.Fatal("expected no execution lease observer for unknown runtime")
	}
}

type codexLeaseTestSessionScript func(ctx context.Context, conn *websocket.Conn)

func newCodexLeaseTestServer(
	t *testing.T,
	scripts []codexLeaseTestSessionScript,
) *httptest.Server {
	t.Helper()

	var sessionIndex int
	var sessionMu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		conn, err := websocket.Accept(writer, request, nil)
		if err != nil {
			t.Errorf("expected websocket accept to succeed: %v", err)
			return
		}

		sessionMu.Lock()
		currentIndex := sessionIndex
		sessionIndex += 1
		sessionMu.Unlock()

		if currentIndex >= len(scripts) {
			conn.CloseNow()
			t.Errorf("unexpected extra Codex lease monitor session %d", currentIndex)
			return
		}

		ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
		defer cancel()
		defer conn.CloseNow()

		scripts[currentIndex](ctx, conn)
	}))

	return server
}

func completeCodexInitializeHandshake(t *testing.T, ctx context.Context, conn *websocket.Conn) {
	t.Helper()

	expectCodexMethodAndRespond(t, ctx, conn, "initialize", map[string]any{
		"userAgent": "mistle_sandbox_runtime",
	})

	messageType, payload, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("expected initialized notification: %v", err)
	}
	if messageType != websocket.MessageText {
		t.Fatalf("expected initialized text message, got %s", messageType.String())
	}

	request := parseCodexRequestForTest(t, payload)
	if request.Method != "initialized" {
		t.Fatalf("expected initialized notification, got %q", request.Method)
	}
}

func expectCodexMethodAndRespond(
	t *testing.T,
	ctx context.Context,
	conn *websocket.Conn,
	expectedMethod string,
	result map[string]any,
) {
	t.Helper()

	request := readCodexRequestForTest(t, ctx, conn)
	if request.Method != expectedMethod {
		t.Fatalf("expected Codex method %q, got %q", expectedMethod, request.Method)
	}

	if err := writeTextJSONMessage(ctx, conn, map[string]any{
		"id":     request.ID,
		"result": result,
	}); err != nil {
		t.Fatalf("expected Codex response write to succeed: %v", err)
	}
}

func expectCodexMethodAndRespondError(
	t *testing.T,
	ctx context.Context,
	conn *websocket.Conn,
	expectedMethod string,
	code int,
	message string,
) {
	t.Helper()

	request := readCodexRequestForTest(t, ctx, conn)
	if request.Method != expectedMethod {
		t.Fatalf("expected Codex method %q, got %q", expectedMethod, request.Method)
	}

	if err := writeTextJSONMessage(ctx, conn, map[string]any{
		"id": request.ID,
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	}); err != nil {
		t.Fatalf("expected Codex error response write to succeed: %v", err)
	}
}

type codexRequestForTest struct {
	ID     any    `json:"id"`
	Method string `json:"method"`
}

func readCodexRequestForTest(
	t *testing.T,
	ctx context.Context,
	conn *websocket.Conn,
) codexRequestForTest {
	t.Helper()

	messageType, payload, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("expected Codex request read to succeed: %v", err)
	}
	if messageType != websocket.MessageText {
		t.Fatalf("expected Codex text request, got %s", messageType.String())
	}

	return parseCodexRequestForTest(t, payload)
}

func parseCodexRequestForTest(t *testing.T, payload []byte) codexRequestForTest {
	t.Helper()

	var request codexRequestForTest
	if err := json.Unmarshal(payload, &request); err != nil {
		t.Fatalf("expected Codex request payload to decode: %v", err)
	}

	return request
}

func waitForCondition(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatal("timed out waiting for condition")
}
