package opencodeproxy

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/idempotency"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestOpenCodeProxyRelaysHTTPRequestsOverWebSocketRuntimeEndpoint(t *testing.T) {
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			<-request.Context().Done()
		case "/session/session_123/message":
			if request.Method != http.MethodPost {
				t.Fatalf("expected POST request, got %s", request.Method)
			}
			if request.URL.RawQuery != "directory=%2Fworkspace" {
				t.Fatalf("expected directory query to be preserved, got %q", request.URL.RawQuery)
			}
			var body map[string]string
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatalf("expected JSON body: %v", err)
			}
			if body["message"] != "hello" {
				t.Fatalf("expected forwarded message body, got %#v", body)
			}
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{"ok":true}`))
		default:
			http.NotFound(writer, request)
		}
	})

	proxy := startTestOpenCodeProxy(t, simulatedServer.URL)
	connection := dialTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()

	writeTestJSON(t, connection, map[string]any{
		"id":     float64(7),
		"method": http.MethodPost,
		"path":   "/session/session_123/message?directory=%2Fworkspace",
		"body": map[string]any{
			"message": "hello",
		},
	})

	response := readTestJSON(t, connection)
	assertTestEqual(t, response["id"], float64(7))
	assertTestEqual(t, response["type"], "response")
	assertTestEqual(t, response["status"], float64(200))
	assertTestEqual(t, response["body"], `{"ok":true}`)
}

func TestOpenCodeProxyStreamsSSEResponsesAndCompletesRequest(t *testing.T) {
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			<-request.Context().Done()
		case "/session/session_123/stream":
			writer.Header().Set("content-type", "text/event-stream")
			_, _ = writer.Write([]byte("event: message\ndata: {\"text\":\"hello\"}\n\n"))
			_, _ = writer.Write([]byte("event: done\ndata: {}\n\n"))
		default:
			http.NotFound(writer, request)
		}
	})

	proxy := startTestOpenCodeProxy(t, simulatedServer.URL)
	connection := dialTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()

	writeTestJSON(t, connection, map[string]any{
		"id":     "stream",
		"method": http.MethodGet,
		"path":   "/session/session_123/stream",
	})

	initialResponse := readTestJSON(t, connection)
	assertTestEqual(t, initialResponse["id"], "stream")
	assertTestEqual(t, initialResponse["type"], "response")
	assertTestEqual(t, initialResponse["status"], float64(200))
	assertTestEqual(t, initialResponse["body"], "")

	firstEvent := readTestJSON(t, connection)
	assertTestEqual(t, firstEvent["id"], "stream")
	assertTestEqual(t, firstEvent["type"], "sse")
	assertTestEqual(t, firstEvent["status"], float64(200))
	assertTestEqual(t, firstEvent["body"], "event: message\ndata: {\"text\":\"hello\"}\n\n")
	assertTestEqual(t, firstEvent["event"], "message")
	assertTestEqual(t, firstEvent["data"], `{"text":"hello"}`)

	secondEvent := readTestJSON(t, connection)
	assertTestEqual(t, secondEvent["type"], "sse")
	assertTestEqual(t, secondEvent["body"], "event: done\ndata: {}\n\n")
	assertTestEqual(t, secondEvent["event"], "done")
	assertTestEqual(t, secondEvent["data"], `{}`)

	complete := readTestJSON(t, connection)
	assertTestEqual(t, complete["id"], "stream")
	assertTestEqual(t, complete["type"], "complete")
	assertTestEqual(t, complete["status"], float64(200))
}

func TestOpenCodeProxyServesLaterRequestsWhileSSEResponseIsOpen(t *testing.T) {
	streamStarted := make(chan struct{})
	finishStream := make(chan struct{})
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			<-request.Context().Done()
		case "/session/session_123/stream":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte("event: message\ndata: {\"text\":\"hello\"}\n\n"))
			if flusher, ok := writer.(http.Flusher); ok {
				flusher.Flush()
			}
			close(streamStarted)
			select {
			case <-finishStream:
			case <-request.Context().Done():
			}
		case "/global/health":
			writer.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(writer, request)
		}
	})

	proxy := startTestOpenCodeProxy(t, simulatedServer.URL)
	connection := dialTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()

	writeTestJSON(t, connection, map[string]any{
		"id":     "stream",
		"method": http.MethodGet,
		"path":   "/session/session_123/stream",
	})
	initialResponse := readTestJSON(t, connection)
	assertTestEqual(t, initialResponse["id"], "stream")
	assertTestEqual(t, initialResponse["type"], "response")
	streamEvent := readTestJSON(t, connection)
	assertTestEqual(t, streamEvent["id"], "stream")
	assertTestEqual(t, streamEvent["type"], "sse")
	assertTestEqual(t, streamEvent["event"], "message")
	assertTestEqual(t, streamEvent["data"], `{"text":"hello"}`)
	select {
	case <-streamStarted:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for simulated OpenCode stream to stay open")
	}

	writeTestJSON(t, connection, map[string]any{
		"id":     "health",
		"method": http.MethodGet,
		"path":   "/global/health",
	})
	healthResponse := readTestJSON(t, connection)
	assertTestEqual(t, healthResponse["id"], "health")
	assertTestEqual(t, healthResponse["type"], "response")
	assertTestEqual(t, healthResponse["status"], float64(http.StatusNoContent))

	close(finishStream)
	complete := readTestJSON(t, connection)
	assertTestEqual(t, complete["id"], "stream")
	assertTestEqual(t, complete["type"], "complete")
}

func TestOpenCodeProxyProjectsSessionStatusActivityToKeepalive(t *testing.T) {
	statusResponse := make(chan string, 1)
	statusResponse <- `{"session_123":{"type":"busy"}}`
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(<-statusResponse))
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
	})

	sharedKeepalive := keepalive.NewSharedManager()
	proxy := startTestOpenCodeProxyWithKeepalive(t, simulatedServer.URL, sharedKeepalive)

	requireEventually(t, func() bool {
		return sharedKeepalive.Active()
	})
	if err := proxy.Close(); err != nil {
		t.Fatalf("expected OpenCode proxy to close cleanly: %v", err)
	}
	requireEventually(t, func() bool {
		return !sharedKeepalive.Active()
	})
}

func TestOpenCodeProxyTreatsRetrySessionStatusAsActive(t *testing.T) {
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{"session_retry":{"type":"retry","attempt":2,"message":"provider temporarily unavailable","next":123}}`))
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
	})

	sharedKeepalive := keepalive.NewSharedManager()
	proxy := startTestOpenCodeProxyWithKeepalive(t, simulatedServer.URL, sharedKeepalive)

	requireEventually(t, func() bool {
		return sharedKeepalive.Active()
	})
	if err := proxy.Close(); err != nil {
		t.Fatalf("expected OpenCode proxy to close cleanly: %v", err)
	}
}

func TestOpenCodeProxyRejectsUnsupportedSessionStatusActivity(t *testing.T) {
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{"session_unknown":{"type":"paused"}}`))
		default:
			http.NotFound(writer, request)
		}
	})
	proxy := startTestOpenCodeProxy(t, simulatedServer.URL)
	defer proxy.Close()

	err := proxy.rebuildActivityFromStatus(context.Background(), map[string]struct{}{})

	if err == nil {
		t.Fatalf("expected unsupported status type to fail")
	}
	if !strings.Contains(err.Error(), `OpenCode session status type "paused" is not supported`) {
		t.Fatalf("expected unsupported status error, got %v", err)
	}
}

func TestOpenCodeProxyRejectsMalformedActivityEventsLikeRust(t *testing.T) {
	proxy := &Proxy{}
	activeSessions := map[string]struct{}{}

	err := proxy.applyActivityEvent("data: {not-json}", activeSessions)

	if err == nil {
		t.Fatalf("expected malformed activity event to fail")
	}
}

func TestOpenCodeProxyRejectsActivityEventsMissingRequiredFieldsLikeRust(t *testing.T) {
	proxy := &Proxy{}
	activeSessions := map[string]struct{}{}

	err := proxy.applyActivityEvent(`data: {"payload":{"type":"session.status","properties":{"status":{"type":"busy"}}}}`, activeSessions)

	if err == nil {
		t.Fatalf("expected missing sessionID to fail")
	}
	if !strings.Contains(err.Error(), "properties.sessionID") {
		t.Fatalf("expected missing sessionID error, got %v", err)
	}
}

func TestOpenCodeProxyRebuildsActivityAfterEventStreamReconnects(t *testing.T) {
	statuses := &lockedString{value: `{}`}
	eventStreamStarted := make(chan struct{}, 1)
	eventToSend := make(chan string, 1)
	closeEventStream := make(chan struct{})
	var eventStreamCount atomic.Int32
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(statuses.get()))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			flusher, _ := writer.(http.Flusher)
			if flusher != nil {
				flusher.Flush()
			}
			select {
			case eventStreamStarted <- struct{}{}:
			default:
			}
			streamNumber := eventStreamCount.Add(1)
			if streamNumber > 1 {
				<-request.Context().Done()
				return
			}
			for {
				select {
				case event := <-eventToSend:
					_, _ = writer.Write([]byte("data: " + event + "\n\n"))
					if flusher != nil {
						flusher.Flush()
					}
				case <-closeEventStream:
					return
				case <-request.Context().Done():
					return
				}
			}
		default:
			http.NotFound(writer, request)
		}
	})

	sharedKeepalive := keepalive.NewSharedManager()
	proxy := startTestOpenCodeProxyWithKeepalive(t, simulatedServer.URL, sharedKeepalive)
	requireEventually(t, func() bool {
		return !sharedKeepalive.Active()
	})
	receiveActivityStreamStart(t, eventStreamStarted)

	eventToSend <- `{"payload":{"type":"session.status","properties":{"sessionID":"session_reconnect","status":{"type":"busy"}}}}`
	requireEventually(t, func() bool {
		return sharedKeepalive.Active()
	})

	statuses.set(`{"session_reconnect":{"type":"busy"}}`)
	close(closeEventStream)
	requireEventually(t, func() bool {
		return !sharedKeepalive.Active()
	})
	requireEventually(t, func() bool {
		return sharedKeepalive.Active()
	})
	if err := proxy.Close(); err != nil {
		t.Fatalf("expected OpenCode proxy to close cleanly: %v", err)
	}
}

func TestOpenCodeProxyReplaysCompletedIdempotentPromptWithoutRepostingToOpenCode(t *testing.T) {
	var requestCount atomic.Int32
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			<-request.Context().Done()
		case "/session/session_123/prompt_async":
			requestCount.Add(1)
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatalf("expected JSON body: %v", err)
			}
			messageID, ok := body["messageID"].(string)
			if !ok || !strings.HasPrefix(messageID, "msg_mistle_") {
				t.Fatalf("expected deterministic OpenCode messageID, got %#v", body["messageID"])
			}
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{"ok":true}`))
		default:
			http.NotFound(writer, request)
		}
	})
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	proxy := startTestOpenCodeProxyWithStore(t, simulatedServer.URL, store)
	connection := dialTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()
	fingerprint := openCodeSubmitFingerprint(t, "hello")

	sendIdempotentPromptRequest(t, connection, "first", fingerprint.Value())
	firstResponse := readTestJSON(t, connection)
	assertTestEqual(t, firstResponse["id"], "first")
	assertTestEqual(t, firstResponse["type"], "response")
	assertTestEqual(t, firstResponse["status"], float64(200))
	assertTestEqual(t, firstResponse["body"], `{"ok":true}`)
	assertTestEqual(t, requestCount.Load(), int32(1))

	sendIdempotentPromptRequest(t, connection, "second", fingerprint.Value())
	secondResponse := readTestJSON(t, connection)
	assertTestEqual(t, secondResponse["id"], "second")
	assertTestEqual(t, secondResponse["type"], "response")
	assertTestEqual(t, secondResponse["status"], float64(200))
	assertTestEqual(t, secondResponse["body"], `{"ok":true}`)
	assertTestEqual(t, requestCount.Load(), int32(1))

	conflictingFingerprint := openCodeSubmitFingerprint(t, "different")
	sendIdempotentPromptRequest(t, connection, "conflict", conflictingFingerprint.Value())
	conflictResponse := readTestJSON(t, connection)
	assertTestEqual(t, conflictResponse["id"], "conflict")
	assertTestEqual(t, conflictResponse["type"], "response")
	assertTestEqual(t, conflictResponse["status"], float64(409))
	conflictBody, ok := conflictResponse["body"].(string)
	if !ok || !strings.Contains(conflictBody, "different request fingerprint") {
		t.Fatalf("expected conflict body, got %#v", conflictResponse["body"])
	}
	assertTestEqual(t, requestCount.Load(), int32(1))
}

func TestOpenCodeProxyReplaysCompletedIdempotentSessionCreationWithoutRepostingToOpenCode(t *testing.T) {
	var requestCount atomic.Int32
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			<-request.Context().Done()
		case "/session":
			requestCount.Add(1)
			if request.Method != http.MethodPost {
				t.Fatalf("expected POST request, got %s", request.Method)
			}
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatalf("expected JSON body: %v", err)
			}
			if body["directory"] != "/workspace" {
				t.Fatalf("expected session directory body, got %#v", body)
			}
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{"id":"session_created","title":"Created"}`))
		default:
			http.NotFound(writer, request)
		}
	})
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	proxy := startTestOpenCodeProxyWithStore(t, simulatedServer.URL, store)
	connection := dialTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()
	fingerprint := openCodeCreateConversationFingerprint(t, "/workspace")

	sendIdempotentCreateSessionRequest(t, connection, "first", fingerprint.Value())
	firstResponse := readTestJSON(t, connection)
	assertTestEqual(t, firstResponse["id"], "first")
	assertTestEqual(t, firstResponse["type"], "response")
	assertTestEqual(t, firstResponse["status"], float64(http.StatusOK))
	assertTestEqual(t, firstResponse["body"], `{"id":"session_created","title":"Created"}`)
	assertTestEqual(t, requestCount.Load(), int32(1))

	sendIdempotentCreateSessionRequest(t, connection, "second", fingerprint.Value())
	secondResponse := readTestJSON(t, connection)
	assertTestEqual(t, secondResponse["id"], "second")
	assertTestEqual(t, secondResponse["type"], "response")
	assertTestEqual(t, secondResponse["status"], float64(http.StatusOK))
	assertTestEqual(t, secondResponse["body"], `{"id":"session_created","title":"Created"}`)
	assertTestEqual(t, requestCount.Load(), int32(1))
}

func TestOpenCodeProxyRejectsUnresolvedStartedIdempotencyRecordWithoutReposting(t *testing.T) {
	var requestCount atomic.Int32
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			<-request.Context().Done()
		case "/session/session_123/prompt_async":
			requestCount.Add(1)
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{"ok":true}`))
		default:
			http.NotFound(writer, request)
		}
	})
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	fingerprint := openCodeSubmitFingerprint(t, "hello")
	_, err = store.StartOperation(idempotency.StartOperation{
		Key:                "delivery-key",
		RuntimeID:          idempotency.AgentRuntimeOpenCode,
		Operation:          idempotency.IdempotencyOperationSubmitPayload,
		RequestFingerprint: fingerprint,
		Now:                "2026-01-02T03:04:05Z",
	})
	if err != nil {
		t.Fatalf("expected started idempotency record to seed: %v", err)
	}
	proxy := startTestOpenCodeProxyWithStore(t, simulatedServer.URL, store)
	connection := dialTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()

	sendIdempotentPromptRequest(t, connection, "started", fingerprint.Value())

	response := readTestJSON(t, connection)
	assertTestEqual(t, response["id"], "started")
	assertTestEqual(t, response["type"], "response")
	assertTestEqual(t, response["status"], float64(http.StatusConflict))
	body, ok := response["body"].(string)
	if !ok || !strings.Contains(body, "unresolved status started") {
		t.Fatalf("expected unresolved started conflict body, got %#v", response["body"])
	}
	assertTestEqual(t, requestCount.Load(), int32(0))
}

func TestOpenCodeProxyReleasesStartedIdempotencyRecordWhenUpstreamResponseBodyFails(t *testing.T) {
	var requestCount atomic.Int32
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			<-request.Context().Done()
		case "/session/session_123/prompt_async":
			count := requestCount.Add(1)
			writer.Header().Set("content-type", "application/json")
			if count == 1 {
				writer.Header().Set("content-length", "100")
				writer.WriteHeader(http.StatusOK)
				_, _ = writer.Write([]byte(`{"partial":`))
				return
			}
			_, _ = writer.Write([]byte(`{"ok":true}`))
		default:
			http.NotFound(writer, request)
		}
	})
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	proxy := startTestOpenCodeProxyWithStore(t, simulatedServer.URL, store)
	connection := dialTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()
	fingerprint := openCodeSubmitFingerprint(t, "hello")

	sendIdempotentPromptRequest(t, connection, "first", fingerprint.Value())
	firstResponse := readTestJSON(t, connection)
	assertTestEqual(t, firstResponse["id"], "first")
	assertTestEqual(t, firstResponse["type"], "response")
	assertTestEqual(t, firstResponse["status"], float64(http.StatusBadGateway))
	body, ok := firstResponse["body"].(string)
	if !ok || !strings.Contains(body, "failed to read OpenCode upstream response") {
		t.Fatalf("expected upstream body failure response, got %#v", firstResponse["body"])
	}
	assertTestEqual(t, requestCount.Load(), int32(1))

	sendIdempotentPromptRequest(t, connection, "second", fingerprint.Value())
	secondResponse := readTestJSON(t, connection)
	assertTestEqual(t, secondResponse["id"], "second")
	assertTestEqual(t, secondResponse["type"], "response")
	assertTestEqual(t, secondResponse["status"], float64(http.StatusOK))
	assertTestEqual(t, secondResponse["body"], `{"ok":true}`)
	assertTestEqual(t, requestCount.Load(), int32(2))
}

func TestOpenCodeProxyReleasesStartedIdempotencyRecordWhenUpstreamFailsBeforeResponse(t *testing.T) {
	var requestCount atomic.Int32
	allowSecondRequest := make(chan struct{})
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			<-request.Context().Done()
		case "/session/session_123/prompt_async":
			count := requestCount.Add(1)
			if count == 1 {
				hijacker, ok := writer.(http.Hijacker)
				if !ok {
					t.Fatalf("expected simulated OpenCode response writer to support hijacking")
				}
				connection, _, err := hijacker.Hijack()
				if err != nil {
					t.Fatalf("expected simulated OpenCode connection hijack to succeed: %v", err)
				}
				_ = connection.Close()
				return
			}
			select {
			case <-allowSecondRequest:
			case <-request.Context().Done():
				return
			}
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{"ok":true}`))
		default:
			http.NotFound(writer, request)
		}
	})
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	proxy := startTestOpenCodeProxyWithStore(t, simulatedServer.URL, store)
	connection := dialTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()
	fingerprint := openCodeSubmitFingerprint(t, "hello")

	sendIdempotentPromptRequest(t, connection, "first", fingerprint.Value())
	firstResponse := readTestJSON(t, connection)
	assertTestEqual(t, firstResponse["id"], "first")
	assertTestEqual(t, firstResponse["type"], "response")
	assertTestEqual(t, firstResponse["status"], float64(http.StatusBadGateway))
	assertTestEqual(t, requestCount.Load(), int32(1))

	close(allowSecondRequest)
	sendIdempotentPromptRequest(t, connection, "second", fingerprint.Value())
	secondResponse := readTestJSON(t, connection)
	assertTestEqual(t, secondResponse["id"], "second")
	assertTestEqual(t, secondResponse["type"], "response")
	assertTestEqual(t, secondResponse["status"], float64(http.StatusOK))
	assertTestEqual(t, secondResponse["body"], `{"ok":true}`)
	assertTestEqual(t, requestCount.Load(), int32(2))
}

func TestOpenCodeProxyCompletesIdempotencyRecordWhenUpstreamReturnsSSEResponse(t *testing.T) {
	var requestCount atomic.Int32
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			<-request.Context().Done()
		case "/session/session_123/prompt_async":
			requestCount.Add(1)
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte("event: message\ndata: {\"type\":\"started\"}\n\n"))
		default:
			http.NotFound(writer, request)
		}
	})
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	proxy := startTestOpenCodeProxyWithStore(t, simulatedServer.URL, store)
	connection := dialTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()
	fingerprint := openCodeSubmitFingerprint(t, "hello")

	sendIdempotentPromptRequest(t, connection, "first", fingerprint.Value())
	firstResponse := readTestJSON(t, connection)
	assertTestEqual(t, firstResponse["id"], "first")
	assertTestEqual(t, firstResponse["type"], "response")
	assertTestEqual(t, firstResponse["status"], float64(http.StatusBadGateway))
	body, ok := firstResponse["body"].(string)
	if !ok || !strings.Contains(body, "cannot replay text/event-stream responses") {
		t.Fatalf("expected SSE idempotency body, got %#v", firstResponse["body"])
	}
	assertTestEqual(t, requestCount.Load(), int32(1))

	sendIdempotentPromptRequest(t, connection, "second", fingerprint.Value())
	secondResponse := readTestJSON(t, connection)
	assertTestEqual(t, secondResponse["id"], "second")
	assertTestEqual(t, secondResponse["type"], "response")
	assertTestEqual(t, secondResponse["status"], float64(http.StatusBadGateway))
	assertTestEqual(t, secondResponse["body"], firstResponse["body"])
	assertTestEqual(t, requestCount.Load(), int32(1))
}

func TestOpenCodeProxyRejectsUnknownIdempotencyEnvelopeFields(t *testing.T) {
	var promptRequestCount atomic.Int32
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			<-request.Context().Done()
		case "/session/session_123/prompt_async":
			promptRequestCount.Add(1)
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{"ok":true}`))
		default:
			http.NotFound(writer, request)
		}
	})
	store, err := idempotency.LoadStore(t.TempDir())
	if err != nil {
		t.Fatalf("expected idempotency store to load: %v", err)
	}
	proxy := startTestOpenCodeProxyWithStore(t, simulatedServer.URL, store)
	connection := dialTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()
	fingerprint := openCodeSubmitFingerprint(t, "hello")

	writeTestJSON(t, connection, map[string]any{
		"id":     "invalid",
		"method": http.MethodPost,
		"path":   "/session/session_123/prompt_async",
		"body": map[string]any{
			"message": "hello",
		},
		"idempotency": map[string]any{
			"key":                "delivery-key",
			"operation":          "submitPayload",
			"requestFingerprint": fingerprint.Value(),
			"unexpected":         "accepted-by-default-json-unmarshal",
		},
	})

	response := readTestJSON(t, connection)
	assertTestEqual(t, response["id"], "invalid")
	assertTestEqual(t, response["type"], "response")
	assertTestEqual(t, response["status"], float64(400))
	body, ok := response["body"].(string)
	if !ok || !strings.Contains(body, "OpenCode idempotency envelope is invalid") || !strings.Contains(body, "unknown field") {
		t.Fatalf("expected strict idempotency error body, got %#v", response["body"])
	}
	assertTestEqual(t, promptRequestCount.Load(), int32(0))
}

func TestOpenCodeSSEParserMatchesRustEventContract(t *testing.T) {
	event := parseOpenCodeSSEEvent("event: message\ndata: first\ndata: second")
	if event == nil {
		t.Fatalf("expected SSE event to parse")
	}
	if event.Event == nil {
		t.Fatalf("expected event name to parse")
	}
	assertTestEqual(t, *event.Event, "message")
	assertTestEqual(t, event.Data, "first\nsecond")

	eventWithoutName := parseOpenCodeSSEEvent("data: {\"type\":\"server.connected\"}")
	if eventWithoutName == nil {
		t.Fatalf("expected data-only SSE event to parse")
	}
	if eventWithoutName.Event != nil {
		t.Fatalf("expected data-only SSE event to omit event name")
	}
	assertTestEqual(t, eventWithoutName.Data, `{"type":"server.connected"}`)

	commentOnlyEvent := parseOpenCodeSSEEvent(": keepalive")
	if commentOnlyEvent != nil {
		t.Fatalf("expected comment-only SSE record to be ignored")
	}
}

func TestOpenCodeProxySurvivesClientDisconnectWhileSSEResponseIsOpen(t *testing.T) {
	eventStreamStarted := make(chan struct{})
	finishEventStream := make(chan struct{})
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/session/status":
			writer.Header().Set("content-type", "application/json")
			_, _ = writer.Write([]byte(`{}`))
		case "/global/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			<-request.Context().Done()
		case "/event":
			writer.Header().Set("content-type", "text/event-stream")
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte("event: message\ndata: {\"type\":\"server.connected\"}\n\n"))
			if flusher, ok := writer.(http.Flusher); ok {
				flusher.Flush()
			}
			close(eventStreamStarted)
			select {
			case <-finishEventStream:
			case <-request.Context().Done():
			}
		case "/global/health":
			writer.Header().Set("content-type", "text/plain")
			_, _ = writer.Write([]byte("ok"))
		default:
			http.NotFound(writer, request)
		}
	})

	proxy := startTestOpenCodeProxy(t, simulatedServer.URL)
	eventConnection := dialTestWebSocket(t, proxy.ListenURL())
	writeTestJSON(t, eventConnection, map[string]any{
		"id":     "events",
		"method": http.MethodGet,
		"path":   "/event",
	})
	eventResponse := readTestJSON(t, eventConnection)
	assertTestEqual(t, eventResponse["id"], "events")
	assertTestEqual(t, eventResponse["type"], "response")
	assertTestEqual(t, eventResponse["status"], float64(http.StatusOK))
	eventFrame := readTestJSON(t, eventConnection)
	assertTestEqual(t, eventFrame["id"], "events")
	assertTestEqual(t, eventFrame["type"], "sse")
	select {
	case <-eventStreamStarted:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for simulated OpenCode SSE stream to stay open")
	}
	eventConnection.CloseNow()

	healthConnection := dialTestWebSocket(t, proxy.ListenURL())
	defer healthConnection.CloseNow()
	writeTestJSON(t, healthConnection, map[string]any{
		"id":     "health",
		"method": http.MethodGet,
		"path":   "/global/health",
	})
	healthResponse := readTestJSON(t, healthConnection)
	assertTestEqual(t, healthResponse["id"], "health")
	assertTestEqual(t, healthResponse["type"], "response")
	assertTestEqual(t, healthResponse["status"], float64(http.StatusOK))
	assertTestEqual(t, healthResponse["body"], "ok")
	close(finishEventStream)
}

func TestOpenCodeProxyReturnsBadGatewayWhenRawServerIsUnavailableAndKeepsProxyAlive(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("expected unavailable listener address to reserve: %v", err)
	}
	rawServerURL := "http://" + listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("expected unavailable listener address to close: %v", err)
	}

	proxy := startTestOpenCodeProxy(t, rawServerURL)
	connection := dialTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()

	writeTestJSON(t, connection, map[string]any{
		"id":     "first",
		"method": http.MethodGet,
		"path":   "/global/health",
	})
	firstResponse := readTestJSON(t, connection)
	assertTestEqual(t, firstResponse["id"], "first")
	assertTestEqual(t, firstResponse["type"], "response")
	assertTestEqual(t, firstResponse["status"], float64(http.StatusBadGateway))

	writeTestJSON(t, connection, map[string]any{
		"id":     "second",
		"method": http.MethodGet,
		"path":   "/global/health",
	})
	secondResponse := readTestJSON(t, connection)
	assertTestEqual(t, secondResponse["id"], "second")
	assertTestEqual(t, secondResponse["type"], "response")
	assertTestEqual(t, secondResponse["status"], float64(http.StatusBadGateway))
}

func TestOpenCodeProxyClosesConnectionForUnknownRequestEnvelopeFieldsLikeRust(t *testing.T) {
	simulatedServer := startSimulatedOpenCodeServer(t, func(writer http.ResponseWriter, request *http.Request) {
		http.NotFound(writer, request)
	})
	proxy := startTestOpenCodeProxy(t, simulatedServer.URL)
	connection := dialTestWebSocket(t, proxy.ListenURL())
	defer connection.CloseNow()

	writeTestJSON(t, connection, map[string]any{
		"id":      "invalid",
		"method":  http.MethodGet,
		"path":    "/global/health",
		"unknown": "field",
	})

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, _, err := connection.Read(ctx); err == nil {
		t.Fatalf("expected invalid OpenCode request envelope to close the websocket")
	}
}

func TestDeriveRawServerURLRequiresOpenCodeGlobalHealthReadiness(t *testing.T) {
	rawServerURL, err := DeriveRawServerURL("http://127.0.0.1:4511/global/health?ignored=true")
	if err != nil {
		t.Fatalf("expected raw server URL to derive: %v", err)
	}
	assertTestEqual(t, rawServerURL, "http://127.0.0.1:4511")

	if _, err := DeriveRawServerURL("ws://127.0.0.1:4511/global/health"); err == nil {
		t.Fatalf("expected websocket readiness URL to fail")
	}
	if _, err := DeriveRawServerURL("http://127.0.0.1:4511/healthz"); err == nil {
		t.Fatalf("expected non-OpenCode health path to fail")
	}
}

// startSimulatedOpenCodeServer models the OpenCode HTTP endpoints exercised by
// the proxy: /session/status, /global/event, and session HTTP/SSE routes.
func startSimulatedOpenCodeServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server
}

func startTestOpenCodeProxy(t *testing.T, rawServerURL string) *Proxy {
	t.Helper()
	return startTestOpenCodeProxyWithKeepalive(t, rawServerURL, keepalive.NewSharedManager())
}

func startTestOpenCodeProxyWithKeepalive(t *testing.T, rawServerURL string, sharedKeepalive *keepalive.SharedManager) *Proxy {
	t.Helper()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-opencode-proxy-test",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentOpenCodeProxy},
	)
	if err != nil {
		t.Fatalf("expected supervisor handle to initialize: %v", err)
	}
	proxy, err := StartOpenCodeProxy("ws://127.0.0.1:0/opencode", rawServerURL, sharedKeepalive, supervisorHandle)
	if err != nil {
		t.Fatalf("expected OpenCode proxy to start: %v", err)
	}
	t.Cleanup(func() {
		_ = proxy.Close()
	})
	return proxy
}

func startTestOpenCodeProxyWithStore(t *testing.T, rawServerURL string, store *idempotency.Store) *Proxy {
	t.Helper()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-opencode-proxy-test",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentOpenCodeProxy},
	)
	if err != nil {
		t.Fatalf("expected supervisor handle to initialize: %v", err)
	}
	proxy, err := StartOpenCodeProxyWithIdempotencyStore("ws://127.0.0.1:0/opencode", rawServerURL, keepalive.NewSharedManager(), supervisorHandle, store)
	if err != nil {
		t.Fatalf("expected OpenCode proxy to start: %v", err)
	}
	t.Cleanup(func() {
		_ = proxy.Close()
	})
	return proxy
}

type lockedString struct {
	mutex sync.Mutex
	value string
}

func (locked *lockedString) get() string {
	locked.mutex.Lock()
	defer locked.mutex.Unlock()
	return locked.value
}

func (locked *lockedString) set(value string) {
	locked.mutex.Lock()
	defer locked.mutex.Unlock()
	locked.value = value
}

func receiveActivityStreamStart(t *testing.T, eventStreamStarted <-chan struct{}) {
	t.Helper()
	select {
	case <-eventStreamStarted:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for OpenCode activity event stream to connect")
	}
}

func sendIdempotentPromptRequest(t *testing.T, connection *websocket.Conn, id string, fingerprint string) {
	t.Helper()
	writeTestJSON(t, connection, map[string]any{
		"id":     id,
		"method": http.MethodPost,
		"path":   "/session/session_123/prompt_async",
		"body": map[string]any{
			"message": "hello",
		},
		"idempotency": map[string]any{
			"key":                "delivery-key",
			"operation":          "submitPayload",
			"requestFingerprint": fingerprint,
		},
	})
}

func sendIdempotentCreateSessionRequest(t *testing.T, connection *websocket.Conn, id string, fingerprint string) {
	t.Helper()
	writeTestJSON(t, connection, map[string]any{
		"id":     id,
		"method": http.MethodPost,
		"path":   "/session",
		"body": map[string]any{
			"directory": "/workspace",
		},
		"idempotency": map[string]any{
			"key":                "create-delivery-key",
			"operation":          "createConversation",
			"requestFingerprint": fingerprint,
		},
	})
}

func openCodeSubmitFingerprint(t *testing.T, inputText string) idempotency.RequestFingerprint {
	t.Helper()
	fingerprint, err := idempotency.RequestFingerprintFromFields(idempotency.AgentRuntimeOpenCode, idempotency.IdempotencyOperationSubmitPayload, map[string]any{
		"inputText": inputText,
	})
	if err != nil {
		t.Fatalf("expected fingerprint to build: %v", err)
	}
	return fingerprint
}

func openCodeCreateConversationFingerprint(t *testing.T, directory string) idempotency.RequestFingerprint {
	t.Helper()
	fingerprint, err := idempotency.RequestFingerprintFromFields(idempotency.AgentRuntimeOpenCode, idempotency.IdempotencyOperationCreateConversation, map[string]any{
		"directory": directory,
	})
	if err != nil {
		t.Fatalf("expected fingerprint to build: %v", err)
	}
	return fingerprint
}

func dialTestWebSocket(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("expected websocket dial to succeed: %v", err)
	}
	return connection
}

func writeTestJSON(t *testing.T, connection *websocket.Conn, value any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	serialized, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("expected JSON encode to succeed: %v", err)
	}
	if err := connection.Write(ctx, websocket.MessageText, serialized); err != nil {
		t.Fatalf("expected websocket write to succeed: %v", err)
	}
}

func readTestJSON(t *testing.T, connection *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, payload, err := connection.Read(ctx)
	if err != nil {
		t.Fatalf("expected websocket read to succeed: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("expected JSON response: %v", err)
	}
	return decoded
}

func requireEventually(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("condition was not satisfied before deadline")
}

func assertTestEqual(t *testing.T, actual any, expected any) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v (%T), got %v (%T)", expected, expected, actual, actual)
	}
}
