package sandboxdstate

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/codexproxy"
	"github.com/mistle/sandboxd/idempotency"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestCodexProxyStartupAllowsRawPeerToDropConnectivityProbeClose(t *testing.T) {
	rawServer := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		requireNoError(t, err)
		connection.CloseNow()
	}))
	defer rawServer.Close()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-codex-proxy-drop-close-test",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentCodexProxy},
	)
	requireNoError(t, err)

	proxy, err := StartCodexProxy(
		CodexProxyPlan{
			ListenURL: reserveLifecycleWebSocketURL(t),
			RawURL:    "ws" + strings.TrimPrefix(rawServer.URL, "http"),
		},
		supervisorHandle,
		keepalive.NewSharedManager(),
	)

	requireNoError(t, err)
	defer proxy.Close()
}

func TestCodexProxyLogsDeliveryContextTurnMappingAndCompletionLikeRust(t *testing.T) {
	var logs bytes.Buffer
	previousOutput := codexProxyLogOutput
	codexProxyLogOutput = &logs
	t.Cleanup(func() {
		codexProxyLogOutput = previousOutput
	})
	relayState := &codexRelayState{
		pendingIdempotency: map[string]codexStartedOperation{},
		clientKind:         codexProxyClientKindMistleAgentClient,
		pendingRequests:    map[string]codexPendingRequest{},
		activeTurns:        map[string]codexActiveTurn{},
	}
	deliveryContext := map[string]any{
		"traceparent":        "00-4cf92f3577c34dc6a3ce929d0e0e4736-00f067cc0dc902d7-01",
		"source":             "webhook",
		"webhookEventId":     "wev_123",
		"deliveryTaskId":     "task_123",
		"externalDeliveryId": "ext_123",
		"triggerRunId":       "trg_123",
		"conversationId":     "conv_123",
		"sandboxInstanceId":  "sbi_123",
		"routeId":            "route_123",
	}
	setDeliveryPayload := mustMarshalCodexProxyTestJSON(t, map[string]any{
		"id":     "delivery",
		"method": codexSetDeliveryContextMethod,
		"params": deliveryContext,
	})
	_, forward, err := prepareCodexClientPayloadForForwarding(context.Background(), nil, setDeliveryPayload, relayState)
	requireNoError(t, err)
	assertEqual(t, forward, false)
	observeCodexClientRequest(map[string]any{
		"id":     "turn-request",
		"method": "turn/start",
		"params": map[string]any{"threadId": "thread_123"},
	}, relayState)

	threadID, retained := codexThreadIDForRetainedSuccessResponse(mustMarshalCodexProxyTestJSON(t, map[string]any{
		"id": "turn-request",
		"result": map[string]any{
			"turn": map[string]any{
				"id":       "turn_123",
				"threadId": "thread_123",
			},
		},
	}), relayState)
	assertEqual(t, retained, true)
	assertEqual(t, threadID, "thread_123")
	observeCodexRawPayload(mustMarshalCodexProxyTestJSON(t, map[string]any{
		"method": "turn/completed",
		"params": map[string]any{
			"turn": map[string]any{
				"id":     "turn_123",
				"status": "completed",
			},
		},
	}), relayState)

	records := parseCodexProxyLogRecords(t, logs.String())
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.delivery_context.received" &&
			record["traceId"] == "4cf92f3577c34dc6a3ce929d0e0e4736" &&
			record["deliveryTaskId"] == "task_123"
	})
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.delivery_context.mapped" &&
			record["threadId"] == "thread_123" &&
			record["turnId"] == "turn_123" &&
			record["providerExecutionId"] == "turn_123"
	})
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.turn.completed" &&
			record["turnId"] == "turn_123" &&
			record["outcome"] == "completed" &&
			record["mistle.turn.request_kind"] == "turn_start"
	})
}

func TestCodexProxyLogsTurnFirstItemAndTransportTerminalEventsLikeRust(t *testing.T) {
	var logs bytes.Buffer
	previousOutput := codexProxyLogOutput
	codexProxyLogOutput = &logs
	t.Cleanup(func() {
		codexProxyLogOutput = previousOutput
	})
	relayState := &codexRelayState{
		clientKind:         codexProxyClientKindMistleAgentClient,
		pendingRequests:    map[string]codexPendingRequest{},
		activeTurns:        map[string]codexActiveTurn{},
		pendingCompactions: map[string]codexPendingCompaction{},
		activeCompactions:  map[string]codexActiveCompaction{},
	}
	relayState.activeTurns["turn_123"] = codexActiveTurn{
		requestKind:     "turn_start",
		threadID:        "thread_123",
		turnID:          "turn_123",
		deliveryContext: codexProxyTestDeliveryContext(),
		startedAt:       time.Now().Add(-time.Second),
	}

	itemStartedPayload := mustMarshalCodexProxyTestJSON(t, map[string]any{
		"method": "item/started",
		"params": map[string]any{
			"turn": map[string]any{"id": "turn_123"},
			"item": map[string]any{"id": "item_123", "type": "message"},
		},
	})
	observeCodexRawPayload(itemStartedPayload, relayState)
	observeCodexRawPayload(itemStartedPayload, relayState)
	finalizeCodexActiveTurnsForTransportOutcome(relayState, "raw_socket_error")

	records := parseCodexProxyLogRecords(t, logs.String())
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.turn.first_item" &&
			record["turnId"] == "turn_123" &&
			record["reason"] == "message"
	})
	assertEqual(t, countCodexProxyLogRecords(records, "codex_proxy.turn.first_item"), 1)
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.turn.interrupted" &&
			record["reason"] == "raw_socket_error" &&
			record["interruptionSource"] == "session_reset"
	})
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.turn.transport_ended" &&
			record["outcome"] == "reset" &&
			record["reason"] == "raw_socket_error"
	})
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.turn.stalled" &&
			record["outcome"] == "stalled"
	})
}

func TestCodexProxyClassifiesFailedAndInterruptedTurnCompletionsLikeRust(t *testing.T) {
	var logs bytes.Buffer
	previousOutput := codexProxyLogOutput
	codexProxyLogOutput = &logs
	t.Cleanup(func() {
		codexProxyLogOutput = previousOutput
	})
	relayState := &codexRelayState{
		clientKind:      codexProxyClientKindMistleAgentClient,
		pendingRequests: map[string]codexPendingRequest{},
		activeTurns:     map[string]codexActiveTurn{},
	}
	relayState.activeTurns["failed_turn"] = codexActiveTurn{
		requestKind:     "turn_steer",
		threadID:        "thread_123",
		turnID:          "failed_turn",
		deliveryContext: codexProxyTestDeliveryContext(),
		startedAt:       time.Now().Add(-time.Second),
	}
	relayState.activeTurns["interrupted_turn"] = codexActiveTurn{
		requestKind:     "turn_start",
		threadID:        "thread_123",
		turnID:          "interrupted_turn",
		deliveryContext: codexProxyTestDeliveryContext(),
		startedAt:       time.Now().Add(-time.Second),
	}

	observeCodexRawPayload(mustMarshalCodexProxyTestJSON(t, map[string]any{
		"method": "turn/completed",
		"params": map[string]any{
			"turn": map[string]any{"id": "failed_turn", "status": "failed"},
		},
	}), relayState)
	observeCodexRawPayload(mustMarshalCodexProxyTestJSON(t, map[string]any{
		"method": "turn/completed",
		"params": map[string]any{
			"turn": map[string]any{"id": "interrupted_turn", "status": "interrupted"},
		},
	}), relayState)

	records := parseCodexProxyLogRecords(t, logs.String())
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.turn.completed" &&
			record["turnId"] == "failed_turn" &&
			record["outcome"] == "failed" &&
			record["reason"] == "failed_before_first_item" &&
			record["mistle.turn.request_kind"] == "turn_steer"
	})
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.turn.completed" &&
			record["turnId"] == "interrupted_turn" &&
			record["outcome"] == "interrupted"
	})
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.turn.interrupted" &&
			record["turnId"] == "interrupted_turn" &&
			record["outcome"] == "interrupted" &&
			record["interruptionSource"] == "unknown_interrupt" &&
			record["interruptionExpected"] == false
	})
}

func TestCodexProxyLogsInterruptRequestsAndStampsInterruptedTurnMetadataLikeRust(t *testing.T) {
	var logs bytes.Buffer
	previousOutput := codexProxyLogOutput
	codexProxyLogOutput = &logs
	t.Cleanup(func() {
		codexProxyLogOutput = previousOutput
	})
	expected := false
	relayState := &codexRelayState{
		clientKind:      codexProxyClientKindOther,
		pendingRequests: map[string]codexPendingRequest{},
		activeTurns: map[string]codexActiveTurn{
			"turn_123": {
				requestKind:          "turn_start",
				threadID:             "thread_123",
				turnID:               "turn_123",
				deliveryContext:      codexProxyTestDeliveryContext(),
				startedAt:            time.Now().Add(-time.Second),
				interruptionExpected: &expected,
			},
		},
		deliveryContext: codexProxyTestDeliveryContext(),
	}
	observeCodexClientRequest(map[string]any{
		"id":     19,
		"method": codexTurnInterruptMethod,
		"params": map[string]any{
			"threadId": "thread_123",
			"turnId":   "turn_123",
		},
	}, relayState)
	observeCodexRawPayload(mustMarshalCodexProxyTestJSON(t, map[string]any{
		"method": "turn/completed",
		"params": map[string]any{
			"turn": map[string]any{"id": "turn_123", "status": "interrupted"},
		},
	}), relayState)

	records := parseCodexProxyLogRecords(t, logs.String())
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.turn.interrupt_requested" &&
			record["turnId"] == "turn_123" &&
			record["interruptionSource"] == "manual_user_interrupt" &&
			record["interruptionExpected"] == true
	})
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.turn.interrupted" &&
			record["turnId"] == "turn_123" &&
			record["interruptionSource"] == "manual_user_interrupt" &&
			record["interruptionExpected"] == true
	})
}

func TestCodexProxyLogsTurnAndCompactionRequestFailuresLikeRust(t *testing.T) {
	var logs bytes.Buffer
	previousOutput := codexProxyLogOutput
	codexProxyLogOutput = &logs
	t.Cleanup(func() {
		codexProxyLogOutput = previousOutput
	})
	relayState := &codexRelayState{
		clientKind:      codexProxyClientKindMistleAgentClient,
		pendingRequests: map[string]codexPendingRequest{},
		activeTurns:     map[string]codexActiveTurn{},
		deliveryContext: codexProxyTestDeliveryContext(),
	}
	observeCodexClientRequest(map[string]any{
		"id":     17,
		"method": "turn/start",
		"params": map[string]any{"threadId": "thread_123"},
	}, relayState)
	observeCodexClientRequest(map[string]any{
		"id":     18,
		"method": codexThreadCompactStartMethod,
		"params": map[string]any{"threadId": "thread_123"},
	}, relayState)

	threadID, retained := codexThreadIDForRetainedSuccessResponse(mustMarshalCodexProxyTestJSON(t, map[string]any{
		"id":    17,
		"error": map[string]any{"code": -32001, "message": "turn rejected"},
	}), relayState)
	assertEqual(t, retained, false)
	assertEqual(t, threadID, "")
	threadID, retained = codexThreadIDForRetainedSuccessResponse(mustMarshalCodexProxyTestJSON(t, map[string]any{
		"id":    18,
		"error": map[string]any{"code": -32001, "message": "compact rejected"},
	}), relayState)
	assertEqual(t, retained, false)
	assertEqual(t, threadID, "")

	records := parseCodexProxyLogRecords(t, logs.String())
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex_proxy.turn.request_failed" &&
			record["threadId"] == "thread_123" &&
			record["reason"] == "rpc_error" &&
			record["error"] == "turn rejected"
	})
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex.thread.compaction_request_failed" &&
			record["threadId"] == "thread_123" &&
			record["compactionTrigger"] == "manual" &&
			record["reason"] == "compact rejected"
	})
}

func TestCodexProxyLogsCompactionLifecycleAndUnknownTerminalOutcomeLikeRust(t *testing.T) {
	var logs bytes.Buffer
	previousOutput := codexProxyLogOutput
	codexProxyLogOutput = &logs
	t.Cleanup(func() {
		codexProxyLogOutput = previousOutput
	})
	relayState := &codexRelayState{
		clientKind:         codexProxyClientKindMistleAgentClient,
		pendingRequests:    map[string]codexPendingRequest{},
		activeTurns:        map[string]codexActiveTurn{},
		pendingCompactions: map[string]codexPendingCompaction{},
		activeCompactions:  map[string]codexActiveCompaction{},
		deliveryContext:    codexProxyTestDeliveryContext(),
	}
	observeCodexClientRequest(map[string]any{
		"id":     "compact_1",
		"method": codexThreadCompactStartMethod,
		"params": map[string]any{"threadId": "thread_123"},
	}, relayState)
	_, retained := codexThreadIDForRetainedSuccessResponse(mustMarshalCodexProxyTestJSON(t, map[string]any{
		"id":     "compact_1",
		"result": map[string]any{},
	}), relayState)
	assertEqual(t, retained, false)
	relayState.activeTurns["turn_123"] = codexActiveTurn{
		requestKind:     "turn_start",
		threadID:        "thread_123",
		turnID:          "turn_123",
		deliveryContext: codexProxyTestDeliveryContext(),
		startedAt:       time.Now().Add(-time.Second),
	}
	observeCodexRawPayload(mustMarshalCodexProxyTestJSON(t, map[string]any{
		"method": "item/started",
		"params": map[string]any{
			"threadId": "thread_123",
			"turn":     map[string]any{"id": "turn_123"},
			"item":     map[string]any{"id": "cmp_123", "type": "contextCompaction"},
		},
	}), relayState)
	finalizeCodexActiveTurnsForTransportOutcome(relayState, "raw_socket_error")

	records := parseCodexProxyLogRecords(t, logs.String())
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex.thread.compaction_requested" &&
			record["compactionState"] == "requested" &&
			record["compactionTrigger"] == "manual"
	})
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex.thread.compaction_started" &&
			record["compactionState"] == "started" &&
			record["compactionTrigger"] == "manual"
	})
	requireCodexProxyLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "codex.thread.compaction_unknown_terminal_outcome" &&
			record["compactionState"] == "unknown_terminal_outcome" &&
			record["compactionTrigger"] == "manual" &&
			record["reason"] == "raw_socket_error"
	})
}

func TestCodexProxyReplaysCompletedIdempotentThreadStartWithoutReforwardingToRaw(t *testing.T) {
	rawRequestCount := atomic.Int32{}
	forwardedPayloads := make(chan map[string]any, 2)
	rawServer := startCodexProxyRawServer(t, func(ctx context.Context, connection codexProxyRawConnection) {
		_, payload, err := connection.Read(ctx)
		if err != nil {
			t.Errorf("expected raw relay request: %v", err)
			return
		}
		rawRequestCount.Add(1)
		var request map[string]any
		if err := json.Unmarshal(payload, &request); err != nil {
			t.Errorf("expected raw relay JSON request: %v", err)
			return
		}
		forwardedPayloads <- request
		response := map[string]any{
			"id": request["id"],
			"result": map[string]any{
				"thread": map[string]any{
					"id": "thread_123",
				},
			},
		}
		writeCodexProxyTestJSON(t, connection, response)
		<-ctx.Done()
	})
	store, err := idempotency.LoadStore(t.TempDir())
	requireNoError(t, err)
	_, proxyListenURL := startTestCodexProxyWithStore(t, rawServer.URL, store)
	client := dialCodexProxyTestWebSocket(t, proxyListenURL)
	defer client.CloseNow()
	fingerprint := codexCreateConversationFingerprint(t, "hello")

	sendIdempotentCodexThreadStart(t, client, "first", fingerprint.Value())
	firstResponse := readCodexProxyTestJSON(t, client)
	assertEqual(t, firstResponse["id"], "first")
	assertEqual(t, rawRequestCount.Load(), int32(1))
	forwarded := <-forwardedPayloads
	if _, exists := forwarded["idempotency"]; exists {
		t.Fatalf("expected idempotency envelope to be stripped before raw forwarding")
	}

	sendIdempotentCodexThreadStart(t, client, "second", fingerprint.Value())
	secondResponse := readCodexProxyTestJSON(t, client)
	assertEqual(t, secondResponse["id"], "second")
	secondResult, ok := secondResponse["result"].(map[string]any)
	if !ok {
		t.Fatalf("expected replayed success response, got %#v", secondResponse)
	}
	secondThread := secondResult["thread"].(map[string]any)
	assertEqual(t, secondThread["id"], "thread_123")
	assertEqual(t, rawRequestCount.Load(), int32(1))

	conflictingFingerprint := codexCreateConversationFingerprint(t, "different")
	sendIdempotentCodexThreadStart(t, client, "conflict", conflictingFingerprint.Value())
	conflictResponse := readCodexProxyTestJSON(t, client)
	assertEqual(t, conflictResponse["id"], "conflict")
	errorPayload := conflictResponse["error"].(map[string]any)
	if errorPayload["code"] != float64(codexIdempotencyErrorCode) {
		t.Fatalf("expected Codex idempotency error code %d, got %#v", codexIdempotencyErrorCode, errorPayload["code"])
	}
	message := errorPayload["message"].(string)
	if !strings.Contains(message, "different request fingerprint") {
		t.Fatalf("expected fingerprint conflict message, got %q", message)
	}
	assertEqual(t, rawRequestCount.Load(), int32(1))
}

func TestCodexProxyReplaysCompletedNonRetainedIdempotentTurnStartWithoutReforwardingToRaw(t *testing.T) {
	rawRequestCount := atomic.Int32{}
	forwardedPayloads := make(chan map[string]any, 2)
	rawServer := startCodexProxyRawServer(t, func(ctx context.Context, connection codexProxyRawConnection) {
		_, payload, err := connection.Read(ctx)
		if err != nil {
			t.Errorf("expected raw turn/start request: %v", err)
			return
		}
		rawRequestCount.Add(1)
		var request map[string]any
		if err := json.Unmarshal(payload, &request); err != nil {
			t.Errorf("expected raw turn/start JSON request: %v", err)
			return
		}
		forwardedPayloads <- request
		writeCodexProxyTestJSON(t, connection, map[string]any{
			"id": request["id"],
			"result": map[string]any{
				"turn": map[string]any{
					"id":       "turn_non_retained",
					"threadId": "thread_non_retained",
				},
			},
		})
		<-ctx.Done()
	})
	store, err := idempotency.LoadStore(t.TempDir())
	requireNoError(t, err)
	_, proxyListenURL := startTestCodexProxyWithStore(t, rawServer.URL, store)
	client := dialCodexProxyTestWebSocket(t, proxyListenURL)
	defer client.CloseNow()
	fingerprint := codexSubmitFingerprint(t, "non-retained-turn-start")

	sendIdempotentCodexTurnStart(t, client, "first", fingerprint.Value())
	firstResponse := readCodexProxyTestJSON(t, client)
	assertEqual(t, firstResponse["id"], "first")
	firstResult := firstResponse["result"].(map[string]any)
	firstTurn := firstResult["turn"].(map[string]any)
	assertEqual(t, firstTurn["id"], "turn_non_retained")
	assertEqual(t, rawRequestCount.Load(), int32(1))
	forwarded := <-forwardedPayloads
	if forwarded["method"] != "turn/start" {
		t.Fatalf("expected raw turn/start, got %#v", forwarded)
	}
	if _, exists := forwarded["idempotency"]; exists {
		t.Fatalf("expected idempotency envelope to be stripped before raw forwarding")
	}

	sendIdempotentCodexTurnStart(t, client, "second", fingerprint.Value())
	secondResponse := readCodexProxyTestJSON(t, client)
	assertEqual(t, secondResponse["id"], "second")
	secondResult := secondResponse["result"].(map[string]any)
	secondTurn := secondResult["turn"].(map[string]any)
	assertEqual(t, secondTurn["id"], "turn_non_retained")
	assertEqual(t, rawRequestCount.Load(), int32(1))
	select {
	case duplicate := <-forwardedPayloads:
		t.Fatalf("expected replayed turn/start not to forward to raw Codex again, got %#v", duplicate)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestCodexProxyRejectsUnknownIdempotencyEnvelopeFields(t *testing.T) {
	forwardedPayloads := make(chan map[string]any, 1)
	rawServer := startCodexProxyRawServer(t, func(ctx context.Context, connection codexProxyRawConnection) {
		_, payload, err := connection.Read(ctx)
		if err != nil {
			return
		}
		var request map[string]any
		if err := json.Unmarshal(payload, &request); err != nil {
			t.Errorf("expected raw relay JSON request: %v", err)
			return
		}
		forwardedPayloads <- request
	})
	store, err := idempotency.LoadStore(t.TempDir())
	requireNoError(t, err)
	_, proxyListenURL := startTestCodexProxyWithStore(t, rawServer.URL, store)
	client := dialCodexProxyTestWebSocket(t, proxyListenURL)
	defer client.CloseNow()
	fingerprint := codexSubmitFingerprint(t, "hello")

	writeCodexProxyTestJSON(t, client, map[string]any{
		"id":     "invalid",
		"method": "turn/start",
		"params": map[string]any{
			"threadId": "thread_123",
		},
		"idempotency": map[string]any{
			"key":                "delivery-key",
			"operation":          "submitPayload",
			"requestFingerprint": fingerprint.Value(),
			"unexpected":         "accepted-by-default-json-unmarshal",
		},
	})

	response := readCodexProxyTestJSON(t, client)
	assertEqual(t, response["id"], "invalid")
	errorPayload := response["error"].(map[string]any)
	if errorPayload["code"] != float64(codexIdempotencyErrorCode) {
		t.Fatalf("expected Codex idempotency error code %d, got %#v", codexIdempotencyErrorCode, errorPayload["code"])
	}
	message := errorPayload["message"].(string)
	if !strings.Contains(message, "Codex idempotency envelope is invalid") || !strings.Contains(message, "unknown field") {
		t.Fatalf("expected strict idempotency error, got %q", message)
	}
	select {
	case forwarded := <-forwardedPayloads:
		t.Fatalf("expected malformed idempotency envelope not to forward to raw Codex, got %#v", forwarded)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestCodexProxyPlanUsesAgentRuntimeKeyForRawProcessReadiness(t *testing.T) {
	plan, err := CodexProxyPlanFromRuntimePlan(runtime.CompiledRuntimePlan{
		RuntimeClients: []runtime.RuntimeClient{
			{
				ClientID: "codex-client",
				Processes: []runtime.RuntimeClientProcess{
					{
						ProcessKey: "codex-app-server",
						Readiness: runtime.RuntimeClientProcessReadiness{
							Type: runtime.RuntimeClientProcessReadinessWS,
							URL:  "ws://127.0.0.1:4010/raw",
						},
					},
				},
				Endpoints: []runtime.RuntimeClientEndpoint{
					{
						EndpointKey:    "app-server",
						ConnectionMode: "dedicated",
						Transport: runtime.RuntimeClientEndpointTransport{
							Type: "ws",
							URL:  "ws://127.0.0.1:4020/codex",
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
				EndpointKey: "app-server",
			},
		},
	})

	requireNoError(t, err)
	if plan == nil {
		t.Fatalf("expected Codex proxy plan")
	}
	assertEqual(t, plan.ListenURL, "ws://127.0.0.1:4020/codex")
	assertEqual(t, plan.RawURL, "ws://127.0.0.1:4010/raw")
}

func TestCodexProxyRetainsTurnStartBeforeDeliveringSuccessResponse(t *testing.T) {
	rawServer := startCodexProxyRawServer(t, func(ctx context.Context, connection codexProxyRawConnection) {
		_, payload, err := connection.Read(ctx)
		if err != nil {
			t.Errorf("expected raw initialize request: %v", err)
			return
		}
		var request map[string]any
		if err := json.Unmarshal(payload, &request); err != nil {
			t.Errorf("expected raw initialize JSON request: %v", err)
			return
		}
		writeCodexProxyTestJSON(t, connection, map[string]any{"id": request["id"], "result": map[string]any{}})
		_, payload, err = connection.Read(ctx)
		if err != nil {
			t.Errorf("expected raw turn/start request: %v", err)
			return
		}
		if err := json.Unmarshal(payload, &request); err != nil {
			t.Errorf("expected raw turn/start JSON request: %v", err)
			return
		}
		writeCodexProxyTestJSON(t, connection, map[string]any{
			"id": request["id"],
			"result": map[string]any{
				"turn": map[string]any{
					"id":       "turn_123",
					"threadId": "thread_123",
				},
			},
		})
		<-ctx.Done()
	})
	store, err := idempotency.LoadStore(t.TempDir())
	requireNoError(t, err)
	_, proxyListenURL := startTestCodexProxyWithStore(t, rawServer.URL, store)
	client := dialCodexProxyTestWebSocket(t, proxyListenURL)
	defer client.CloseNow()

	writeCodexProxyTestJSON(t, client, map[string]any{
		"id":     "initialize",
		"method": "initialize",
		"params": map[string]any{
			"clientInfo": map[string]any{
				"title": codexproxy.MistleAgentClientTitle,
			},
		},
	})
	initializeResponse := readCodexProxyTestJSON(t, client)
	assertEqual(t, initializeResponse["id"], "initialize")
	writeCodexProxyTestJSON(t, client, map[string]any{
		"id":     "turn",
		"method": "turn/start",
		"params": map[string]any{
			"threadId": "thread_123",
		},
	})
	response := readCodexProxyTestJSON(t, client)
	if response["error"] != nil {
		t.Fatalf("expected retained turn/start success response, got %#v", response)
	}
	result := response["result"].(map[string]any)
	turn := result["turn"].(map[string]any)
	assertEqual(t, turn["id"], "turn_123")
}

func TestCodexProxyRetainsTurnSteerBeforeDeliveringSuccessResponse(t *testing.T) {
	sessionManagerResumeRequested := make(chan map[string]any, 1)
	completeSessionManagerResume := make(chan struct{})
	rawServer := startCodexProxyRawServerWithSessionManagerHandler(t, func(ctx context.Context, connection codexProxyRawConnection, firstPayload []byte) {
		var request map[string]any
		if err := json.Unmarshal(firstPayload, &request); err != nil {
			t.Errorf("expected raw initialize JSON request: %v", err)
			return
		}
		writeCodexProxyTestJSON(t, connection, map[string]any{"id": request["id"], "result": map[string]any{}})
		_, payload, err := connection.Read(ctx)
		if err != nil {
			t.Errorf("expected raw turn/steer request: %v", err)
			return
		}
		if err := json.Unmarshal(payload, &request); err != nil {
			t.Errorf("expected raw turn/steer JSON request: %v", err)
			return
		}
		writeCodexProxyTestJSON(t, connection, map[string]any{
			"id": request["id"],
			"result": map[string]any{
				"turnId": "turn_123",
			},
		})
		<-ctx.Done()
	}, func(ctx context.Context, connection *websocket.Conn, request map[string]any) {
		if request["method"] == "thread/resume" {
			sessionManagerResumeRequested <- request
			select {
			case <-completeSessionManagerResume:
			case <-ctx.Done():
				return
			}
		}
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
	})
	store, err := idempotency.LoadStore(t.TempDir())
	requireNoError(t, err)
	_, proxyListenURL := startTestCodexProxyWithStore(t, rawServer.URL, store)
	client := dialCodexProxyTestWebSocket(t, proxyListenURL)
	defer client.CloseNow()

	writeCodexProxyTestJSON(t, client, map[string]any{
		"id":     "initialize",
		"method": "initialize",
		"params": map[string]any{
			"clientInfo": map[string]any{
				"title": codexproxy.MistleAgentClientTitle,
			},
		},
	})
	initializeResponse := readCodexProxyTestJSON(t, client)
	assertEqual(t, initializeResponse["id"], "initialize")
	writeCodexProxyTestJSON(t, client, map[string]any{
		"id":     "steer",
		"method": "turn/steer",
		"params": map[string]any{
			"threadId": "thread_123",
			"turnId":   "turn_122",
		},
	})

	resumeRequest := receiveCodexProxyTestJSON(t, sessionManagerResumeRequested)
	assertEqual(t, resumeRequest["method"], "thread/resume")
	resumeParams := resumeRequest["params"].(map[string]any)
	assertEqual(t, resumeParams["threadId"], "thread_123")
	steerResponseBeforeRetention := readCodexProxyTestJSONAsync(t, client)
	select {
	case response := <-steerResponseBeforeRetention:
		t.Fatalf("expected turn/steer response to wait for retained thread subscription, got %#v", response)
	case <-time.After(50 * time.Millisecond):
	}

	close(completeSessionManagerResume)
	response := receiveCodexProxyTestJSON(t, steerResponseBeforeRetention)
	assertEqual(t, response["id"], "steer")
	if response["error"] != nil {
		t.Fatalf("expected retained turn/steer success response, got %#v", response)
	}
	result := response["result"].(map[string]any)
	assertEqual(t, result["turnId"], "turn_123")
}

func TestCodexProxyDoesNotRetainTurnStartForOtherClients(t *testing.T) {
	sessionManagerResumeRequested := make(chan struct{}, 1)
	rawServer := startCodexProxyRawServerWithSessionManagerHandler(t, func(ctx context.Context, connection codexProxyRawConnection, firstPayload []byte) {
		var request map[string]any
		if err := json.Unmarshal(firstPayload, &request); err != nil {
			t.Errorf("expected raw initialize JSON request: %v", err)
			return
		}
		writeCodexProxyTestJSON(t, connection, map[string]any{"id": request["id"], "result": map[string]any{}})
		_, payload, err := connection.Read(ctx)
		if err != nil {
			t.Errorf("expected raw turn/start request: %v", err)
			return
		}
		if err := json.Unmarshal(payload, &request); err != nil {
			t.Errorf("expected raw turn/start JSON request: %v", err)
			return
		}
		writeCodexProxyTestJSON(t, connection, map[string]any{
			"id": request["id"],
			"result": map[string]any{
				"turn": map[string]any{
					"id":       "turn_123",
					"threadId": "thread_123",
				},
			},
		})
		<-ctx.Done()
	}, func(ctx context.Context, connection *websocket.Conn, request map[string]any) {
		if request["method"] == "thread/resume" {
			sessionManagerResumeRequested <- struct{}{}
			<-ctx.Done()
			return
		}
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
	})
	store, err := idempotency.LoadStore(t.TempDir())
	requireNoError(t, err)
	_, proxyListenURL := startTestCodexProxyWithStore(t, rawServer.URL, store)
	client := dialCodexProxyTestWebSocket(t, proxyListenURL)
	defer client.CloseNow()

	writeCodexProxyTestJSON(t, client, map[string]any{
		"id":     "initialize",
		"method": "initialize",
		"params": map[string]any{
			"clientInfo": map[string]any{
				"title": "Other Client",
			},
		},
	})
	initializeResponse := readCodexProxyTestJSON(t, client)
	assertEqual(t, initializeResponse["id"], "initialize")
	writeCodexProxyTestJSON(t, client, map[string]any{
		"id":     "turn",
		"method": "turn/start",
		"params": map[string]any{
			"threadId": "thread_123",
		},
	})
	response := readCodexProxyTestJSON(t, client)
	assertEqual(t, response["id"], "turn")
	select {
	case <-sessionManagerResumeRequested:
		t.Fatalf("expected non-Mistle client turn/start not to request retained thread subscription")
	case <-time.After(100 * time.Millisecond):
	}
}

func TestCodexProxyClearsPendingTurnRequestAfterErrorResponse(t *testing.T) {
	sessionManagerResumeRequested := make(chan struct{}, 1)
	rawServer := startCodexProxyRawServerWithSessionManagerHandler(t, func(ctx context.Context, connection codexProxyRawConnection, firstPayload []byte) {
		var request map[string]any
		if err := json.Unmarshal(firstPayload, &request); err != nil {
			t.Errorf("expected raw initialize JSON request: %v", err)
			return
		}
		writeCodexProxyTestJSON(t, connection, map[string]any{"id": request["id"], "result": map[string]any{}})
		_, payload, err := connection.Read(ctx)
		if err != nil {
			t.Errorf("expected raw failed turn/start request: %v", err)
			return
		}
		if err := json.Unmarshal(payload, &request); err != nil {
			t.Errorf("expected raw failed turn/start JSON request: %v", err)
			return
		}
		writeCodexProxyTestJSON(t, connection, map[string]any{
			"id": request["id"],
			"error": map[string]any{
				"code":    -32000,
				"message": "turn rejected",
			},
		})
		_, payload, err = connection.Read(ctx)
		if err != nil {
			t.Errorf("expected raw reused-id request: %v", err)
			return
		}
		if err := json.Unmarshal(payload, &request); err != nil {
			t.Errorf("expected raw reused-id JSON request: %v", err)
			return
		}
		writeCodexProxyTestJSON(t, connection, map[string]any{
			"id": request["id"],
			"result": map[string]any{
				"threadId": "thread_123",
			},
		})
		<-ctx.Done()
	}, func(ctx context.Context, connection *websocket.Conn, request map[string]any) {
		if request["method"] == "thread/resume" {
			sessionManagerResumeRequested <- struct{}{}
			<-ctx.Done()
			return
		}
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
	})
	store, err := idempotency.LoadStore(t.TempDir())
	requireNoError(t, err)
	_, proxyListenURL := startTestCodexProxyWithStore(t, rawServer.URL, store)
	client := dialCodexProxyTestWebSocket(t, proxyListenURL)
	defer client.CloseNow()

	writeCodexProxyTestJSON(t, client, map[string]any{
		"id":     "initialize",
		"method": "initialize",
		"params": map[string]any{
			"clientInfo": map[string]any{
				"title": codexproxy.MistleAgentClientTitle,
			},
		},
	})
	initializeResponse := readCodexProxyTestJSON(t, client)
	assertEqual(t, initializeResponse["id"], "initialize")
	writeCodexProxyTestJSON(t, client, map[string]any{
		"id":     "reused",
		"method": "turn/start",
		"params": map[string]any{
			"threadId": "thread_123",
		},
	})
	errorResponse := readCodexProxyTestJSON(t, client)
	assertEqual(t, errorResponse["id"], "reused")
	if errorResponse["error"] == nil {
		t.Fatalf("expected turn/start error response, got %#v", errorResponse)
	}
	writeCodexProxyTestJSON(t, client, map[string]any{
		"id":     "reused",
		"method": "thread/loaded/list",
		"params": map[string]any{},
	})
	reusedResponse := readCodexProxyTestJSON(t, client)
	assertEqual(t, reusedResponse["id"], "reused")
	select {
	case <-sessionManagerResumeRequested:
		t.Fatalf("expected failed turn/start pending request to be cleared before reused id response")
	case <-time.After(100 * time.Millisecond):
	}
}

func TestCodexProxyConsumesMistleDeliveryContextWithoutForwardingToRaw(t *testing.T) {
	forwardedPayloads := make(chan map[string]any, 1)
	rawServer := startCodexProxyRawServer(t, func(ctx context.Context, connection codexProxyRawConnection) {
		_, payload, err := connection.Read(ctx)
		if err != nil {
			t.Errorf("expected raw relay request: %v", err)
			return
		}
		var request map[string]any
		if err := json.Unmarshal(payload, &request); err != nil {
			t.Errorf("expected raw relay JSON request: %v", err)
			return
		}
		forwardedPayloads <- request
		writeCodexProxyTestJSON(t, connection, map[string]any{
			"id":     request["id"],
			"result": map[string]any{"data": []any{}},
		})
		<-ctx.Done()
	})
	store, err := idempotency.LoadStore(t.TempDir())
	requireNoError(t, err)
	_, proxyListenURL := startTestCodexProxyWithStore(t, rawServer.URL, store)
	client := dialCodexProxyTestWebSocket(t, proxyListenURL)
	defer client.CloseNow()

	writeCodexProxyTestJSON(t, client, map[string]any{
		"id":     "delivery",
		"method": "mistle/setDeliveryContext",
		"params": map[string]any{
			"traceparent":       "00-4cf92f3577c34dc6a3ce929d0e0e4736-00f067cc0dc902d7-01",
			"source":            "webhook",
			"webhookEventId":    "evt_123",
			"deliveryTaskId":    "dtask_123",
			"triggerRunId":      "trigger_123",
			"conversationId":    "conv_123",
			"sandboxInstanceId": "sbi_123",
		},
	})
	writeCodexProxyTestJSON(t, client, map[string]any{
		"id":     "list",
		"method": "thread/loaded/list",
		"params": map[string]any{},
	})

	response := readCodexProxyTestJSON(t, client)
	assertEqual(t, response["id"], "list")
	forwarded := <-forwardedPayloads
	assertEqual(t, forwarded["method"], "thread/loaded/list")
}

func TestCodexProxyBufferedSuccessResponsesFlushOnlyFromHead(t *testing.T) {
	serverConnection := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		serverConnection <- connection
		<-request.Context().Done()
	}))
	defer server.Close()
	client := dialCodexProxyTestWebSocket(t, "ws"+strings.TrimPrefix(server.URL, "http"))
	defer client.CloseNow()
	destination := <-serverConnection
	defer destination.CloseNow()
	retentionResult := make(chan error, 1)
	bufferedResponses := []codexBufferedSuccessResponse{
		{
			messageType:     websocket.MessageText,
			payload:         []byte(`{"id":1}`),
			retentionResult: retentionResult,
		},
		{
			messageType:    websocket.MessageText,
			payload:        []byte(`{"id":2}`),
			retentionReady: true,
		},
	}
	firstRead := readCodexProxyTestJSONAsync(t, client)

	if !flushReadyCodexResponses(context.Background(), destination, &codexRelayState{}, &bufferedResponses) {
		t.Fatalf("expected unresolved head response to leave relay open")
	}
	assertEqual(t, len(bufferedResponses), 2)
	select {
	case message := <-firstRead:
		t.Fatalf("expected no client message before head buffered response is ready, got %#v", message)
	case <-time.After(50 * time.Millisecond):
	}

	retentionResult <- nil
	if !flushReadyCodexResponses(context.Background(), destination, &codexRelayState{}, &bufferedResponses) {
		t.Fatalf("expected ready buffered responses to flush")
	}
	assertEqual(t, len(bufferedResponses), 0)
	first := receiveCodexProxyTestJSON(t, firstRead)
	assertEqual(t, first["id"].(float64), float64(1))
	second := readCodexProxyTestJSON(t, client)
	assertEqual(t, second["id"].(float64), float64(2))
}

type codexProxyRawConnection interface {
	Read(context.Context) (websocket.MessageType, []byte, error)
	Write(context.Context, websocket.MessageType, []byte) error
}

type codexProxyRawRelayHandler func(context.Context, codexProxyRawConnection)
type codexProxySessionManagerRequestHandler func(context.Context, *websocket.Conn, map[string]any)

func startCodexProxyRawServer(t *testing.T, relayHandler codexProxyRawRelayHandler) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		ctx := request.Context()
		_, payload, err := connection.Read(ctx)
		if err != nil {
			return
		}
		var firstMessage map[string]any
		if err := json.Unmarshal(payload, &firstMessage); err != nil {
			t.Errorf("expected first raw message to decode: %v", err)
			return
		}
		if isCodexSessionManagerInitialize(firstMessage) {
			writeCodexProxyTestJSON(t, connection, map[string]any{"id": firstMessage["id"], "result": map[string]any{}})
			_, _, _ = connection.Read(ctx)
			_, listPayload, err := connection.Read(ctx)
			if err != nil {
				return
			}
			var listRequest map[string]any
			if err := json.Unmarshal(listPayload, &listRequest); err != nil {
				t.Errorf("expected loaded list request: %v", err)
				return
			}
			writeCodexProxyTestJSON(t, connection, map[string]any{"id": listRequest["id"], "result": map[string]any{"data": []any{}}})
			for {
				_, requestPayload, err := connection.Read(ctx)
				if err != nil {
					return
				}
				var request map[string]any
				if err := json.Unmarshal(requestPayload, &request); err != nil {
					t.Errorf("expected session manager request: %v", err)
					return
				}
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
		relayHandler(ctx, &firstMessageReplayConn{Conn: connection, firstPayload: payload})
	}))
	t.Cleanup(server.Close)
	return server
}

func startCodexProxyRawServerWithSessionManagerHandler(
	t *testing.T,
	relayHandler func(context.Context, codexProxyRawConnection, []byte),
	sessionManagerRequestHandler codexProxySessionManagerRequestHandler,
) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		ctx := request.Context()
		_, payload, err := connection.Read(ctx)
		if err != nil {
			return
		}
		var firstMessage map[string]any
		if err := json.Unmarshal(payload, &firstMessage); err != nil {
			t.Errorf("expected first raw message to decode: %v", err)
			return
		}
		if isCodexSessionManagerInitialize(firstMessage) {
			writeCodexProxyTestJSON(t, connection, map[string]any{"id": firstMessage["id"], "result": map[string]any{}})
			_, _, _ = connection.Read(ctx)
			_, listPayload, err := connection.Read(ctx)
			if err != nil {
				return
			}
			var listRequest map[string]any
			if err := json.Unmarshal(listPayload, &listRequest); err != nil {
				t.Errorf("expected loaded list request: %v", err)
				return
			}
			writeCodexProxyTestJSON(t, connection, map[string]any{"id": listRequest["id"], "result": map[string]any{"data": []any{}}})
			for {
				_, requestPayload, err := connection.Read(ctx)
				if err != nil {
					return
				}
				var sessionManagerRequest map[string]any
				if err := json.Unmarshal(requestPayload, &sessionManagerRequest); err != nil {
					t.Errorf("expected session manager request: %v", err)
					return
				}
				sessionManagerRequestHandler(ctx, connection, sessionManagerRequest)
			}
		}
		relayHandler(ctx, connection, payload)
	}))
	t.Cleanup(server.Close)
	return server
}

func isCodexSessionManagerInitialize(message map[string]any) bool {
	if message["method"] != "initialize" || message["id"] != float64(1) {
		return false
	}
	params, _ := message["params"].(map[string]any)
	clientInfo, _ := params["clientInfo"].(map[string]any)
	return clientInfo["title"] == codexproxy.InitializeClientTitle
}

type firstMessageReplayConn struct {
	*websocket.Conn
	firstPayload []byte
	usedFirst    bool
}

func (connection *firstMessageReplayConn) Read(ctx context.Context) (websocket.MessageType, []byte, error) {
	if !connection.usedFirst {
		connection.usedFirst = true
		return websocket.MessageText, connection.firstPayload, nil
	}
	return connection.Conn.Read(ctx)
}

func startTestCodexProxyWithStore(t *testing.T, rawHTTPURL string, store *idempotency.Store) (*CodexProxyHandle, string) {
	t.Helper()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandboxd-codex-proxy-test",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentCodexProxy},
	)
	requireNoError(t, err)
	listenURL := reserveLifecycleWebSocketURL(t)
	proxy, err := StartCodexProxyWithIdempotencyStore(
		CodexProxyPlan{
			ListenURL: listenURL,
			RawURL:    "ws" + strings.TrimPrefix(rawHTTPURL, "http"),
		},
		supervisorHandle,
		keepalive.NewSharedManager(),
		store,
	)
	requireNoError(t, err)
	t.Cleanup(func() {
		_ = proxy.Close()
	})
	return proxy, listenURL
}

func dialCodexProxyTestWebSocket(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, url, nil)
	requireNoError(t, err)
	return connection
}

func sendIdempotentCodexThreadStart(t *testing.T, connection *websocket.Conn, id string, fingerprint string) {
	t.Helper()
	writeCodexProxyTestJSON(t, connection, map[string]any{
		"id":     id,
		"method": "thread/start",
		"params": map[string]any{},
		"idempotency": map[string]any{
			"key":                "delivery-key",
			"operation":          "createConversation",
			"requestFingerprint": fingerprint,
		},
	})
}

func sendIdempotentCodexTurnStart(t *testing.T, connection *websocket.Conn, id string, fingerprint string) {
	t.Helper()
	writeCodexProxyTestJSON(t, connection, map[string]any{
		"id":     id,
		"method": "turn/start",
		"params": map[string]any{
			"threadId": "thread_non_retained",
			"prompt":   "hello",
		},
		"idempotency": map[string]any{
			"key":                "turn-delivery-key",
			"operation":          "submitPayload",
			"requestFingerprint": fingerprint,
		},
	})
}

func writeCodexProxyTestJSON(t *testing.T, connection interface {
	Write(context.Context, websocket.MessageType, []byte) error
}, value any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	serialized, err := json.Marshal(value)
	requireNoError(t, err)
	requireNoError(t, connection.Write(ctx, websocket.MessageText, serialized))
}

func readCodexProxyTestJSON(t *testing.T, connection *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, payload, err := connection.Read(ctx)
	requireNoError(t, err)
	var decoded map[string]any
	requireNoError(t, json.Unmarshal(payload, &decoded))
	return decoded
}

func mustMarshalCodexProxyTestJSON(t *testing.T, value any) []byte {
	t.Helper()
	serialized, err := json.Marshal(value)
	requireNoError(t, err)
	return serialized
}

func parseCodexProxyLogRecords(t *testing.T, text string) []map[string]any {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(text), "\n")
	records := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var record map[string]any
		requireNoError(t, json.Unmarshal([]byte(line), &record))
		records = append(records, record)
	}
	return records
}

func requireCodexProxyLogRecord(t *testing.T, records []map[string]any, matches func(map[string]any) bool) {
	t.Helper()
	for _, record := range records {
		if matches(record) {
			return
		}
	}
	t.Fatalf("expected matching Codex proxy log record in %#v", records)
}

func countCodexProxyLogRecords(records []map[string]any, event string) int {
	count := 0
	for _, record := range records {
		if record["event"] == event {
			count++
		}
	}
	return count
}

func codexProxyTestDeliveryContext() *codexDeliveryContextPayload {
	webhookEventID := "wev_123"
	externalDeliveryID := "ext_123"
	routeID := "route_123"
	return &codexDeliveryContextPayload{
		Traceparent:        "00-4cf92f3577c34dc6a3ce929d0e0e4736-00f067cc0dc902d7-01",
		Source:             codexDeliveryContextSourceWebhook,
		WebhookEventID:     &webhookEventID,
		DeliveryTaskID:     "cdt_123",
		ExternalDeliveryID: &externalDeliveryID,
		TriggerRunID:       "trg_123",
		ConversationID:     "conv_123",
		SandboxInstanceID:  "sbi_123",
		RouteID:            &routeID,
	}
}

func readCodexProxyTestJSONAsync(t *testing.T, connection *websocket.Conn) <-chan map[string]any {
	t.Helper()
	result := make(chan map[string]any, 1)
	go func() {
		result <- readCodexProxyTestJSON(t, connection)
	}()
	return result
}

func receiveCodexProxyTestJSON(t *testing.T, values <-chan map[string]any) map[string]any {
	t.Helper()
	select {
	case value := <-values:
		return value
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for Codex proxy JSON message")
		return nil
	}
}

func codexSubmitFingerprint(t *testing.T, inputText string) idempotency.RequestFingerprint {
	t.Helper()
	fingerprint, err := idempotency.RequestFingerprintFromFields(idempotency.AgentRuntimeCodex, idempotency.IdempotencyOperationSubmitPayload, map[string]any{
		"inputText": inputText,
	})
	requireNoError(t, err)
	return fingerprint
}

func codexCreateConversationFingerprint(t *testing.T, inputText string) idempotency.RequestFingerprint {
	t.Helper()
	fingerprint, err := idempotency.RequestFingerprintFromFields(idempotency.AgentRuntimeCodex, idempotency.IdempotencyOperationCreateConversation, map[string]any{
		"inputText": inputText,
	})
	requireNoError(t, err)
	return fingerprint
}
