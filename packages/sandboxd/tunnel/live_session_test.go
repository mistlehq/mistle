package tunnel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/keepalive"
	mistleprotocol "github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime/readiness"
	"github.com/mistle/sandboxd/startupdiagnostics"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

func TestLiveTunnelSessionRelaysAgentWebSocketTraffic(t *testing.T) {
	agentServer := startLiveSessionAgentServer(t)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AgentEndpointURL:        liveSessionWebSocketURL(agentServer),
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(7),
		"channel":  map[string]any{"kind": "agent"},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	assertEqual(t, openOK["streamId"].(float64), float64(7))

	encoded, err := tunnelprotocol.EncodeStreamDataFrame(7, tunnelprotocol.PayloadKindWebSocketText, []byte("hello-agent"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))

	messageType, payload, err := gatewayConnection.Read(ctx)
	requireNoError(t, err)
	assertEqual(t, messageType, websocket.MessageBinary)
	frame, err := tunnelprotocol.DecodeStreamDataFrame(payload)
	requireNoError(t, err)
	assertEqual(t, frame.StreamID, uint32(7))
	assertEqual(t, frame.PayloadKind, tunnelprotocol.PayloadKindWebSocketText)
	assertEqual(t, string(frame.Payload), "hello-gateway")
}

func TestLiveTunnelSessionUsesUpdatedAgentEndpointForLaterStreams(t *testing.T) {
	agentServer := startLiveSessionAgentServer(t)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AgentEndpointURL:        "ws://127.0.0.1:1/unavailable-agent",
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	session.SetAgentEndpointURL(liveSessionWebSocketURL(agentServer))
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(7),
		"channel":  map[string]any{"kind": "agent"},
	})
	openOK := readControlOfType(t, gatewayConnection, "stream.open.ok")
	assertEqual(t, openOK["streamId"].(float64), float64(7))

	encoded, err := tunnelprotocol.EncodeStreamDataFrame(7, tunnelprotocol.PayloadKindWebSocketText, []byte("hello-agent"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))

	frame := liveSessionReadFrame(t, gatewayConnection)
	assertEqual(t, frame.StreamID, uint32(7))
	assertEqual(t, frame.PayloadKind, tunnelprotocol.PayloadKindWebSocketText)
	assertEqual(t, string(frame.Payload), "hello-gateway")
}

func TestLiveTunnelSessionPublishesAgentStreamSummaryTelemetry(t *testing.T) {
	agentServer := startLiveSessionAgentServer(t)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	clock := timeutil.NewMutableClock(1730000000000)
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AgentEndpointURL:        liveSessionWebSocketURL(agentServer),
		Clock:                   clock,
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":               "telemetry.open.ok",
		"streamId":           float64(SandboxTelemetryLogStreamID),
		"initialWindowBytes": float64(4096),
	})

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(7),
		"channel":  map[string]any{"kind": "agent"},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")

	encoded, err := tunnelprotocol.EncodeStreamDataFrame(7, tunnelprotocol.PayloadKindWebSocketText, []byte("hello-agent"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))
	frame := liveSessionReadFrame(t, gatewayConnection)
	assertEqual(t, frame.StreamID, uint32(7))
	assertEqual(t, string(frame.Payload), "hello-gateway")
	clock.AdvanceMS(200)
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.window",
		"streamId": float64(7),
		"bytes":    float64(len("hello-gateway")),
	})

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.close",
		"streamId": float64(7),
	})
	summary := readTelemetryRecordOfEvent(t, gatewayConnection, telemetryEventAgentSummary)
	assertEqual(t, summary["level"].(string), telemetryLogLevelInfo)
	assertEqual(t, summary["streamId"].(float64), float64(7))
	assertEqual(t, summary["channelKind"].(string), "agent")
	assertEqual(t, summary["outcome"].(string), "closed")
	assertEqual(t, summary["closeSource"].(string), "gateway")
	assertEqual(t, summary["messageCountIn"].(float64), float64(1))
	assertEqual(t, summary["messageCountOut"].(float64), float64(1))
	assertEqual(t, summary["totalBytesIn"].(float64), float64(len("hello-agent")))
	assertEqual(t, summary["totalBytesOut"].(float64), float64(len("hello-gateway")))
	assertEqual(t, summary["maxMessageBytesIn"].(float64), float64(len("hello-agent")))
	assertEqual(t, summary["maxMessageBytesOut"].(float64), float64(len("hello-gateway")))
	assertEqual(t, summary["maxOutstandingBytes"].(float64), float64(len("hello-gateway")))
	assertEqual(t, summary["avgCreditReturnMs"].(float64), float64(200))
	assertEqual(t, summary["creditReturnCount"].(float64), float64(1))
	if summary["resetCode"] != nil {
		t.Fatalf("expected resetCode to be null, got %#v", summary["resetCode"])
	}
	if summary["reason"] != nil {
		t.Fatalf("expected reason to be null, got %#v", summary["reason"])
	}
}

func TestLiveTunnelSessionResetsAgentStreamWhenRuntimeExhaustsSendWindow(t *testing.T) {
	agentServer := startLiveSessionTriggeredAgentServer(t, []byte("too-large"))
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AgentEndpointURL:        liveSessionWebSocketURL(agentServer),
		Clock:                   timeutil.NewMutableClock(1730000000000),
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":               "telemetry.open.ok",
		"streamId":           float64(SandboxTelemetryLogStreamID),
		"initialWindowBytes": float64(4096),
	})

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(8),
		"channel":  map[string]any{"kind": "agent"},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	session.mutex.Lock()
	session.streams[8].window = 0
	session.mutex.Unlock()
	encoded, err := tunnelprotocol.EncodeStreamDataFrame(8, tunnelprotocol.PayloadKindWebSocketText, []byte("release"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))

	exhausted := readTelemetryRecordOfEvent(t, gatewayConnection, telemetryEventAgentExhausted)
	assertEqual(t, exhausted["level"].(string), telemetryLogLevelWarn)
	assertEqual(t, exhausted["streamId"].(float64), float64(8))
	assertEqual(t, exhausted["payloadBytes"].(float64), float64(len("too-large")))
	assertEqual(t, exhausted["payloadExceedsAvailableWindow"].(bool), true)
	if exhausted["oldestUnackedMs"] != nil {
		t.Fatalf("expected oldestUnackedMs to be null, got %#v", exhausted["oldestUnackedMs"])
	}
	summary := readTelemetryRecordOfEvent(t, gatewayConnection, telemetryEventAgentSummary)
	assertEqual(t, summary["outcome"].(string), "reset")
	assertEqual(t, summary["closeSource"].(string), "runtime")
	assertEqual(t, summary["resetCode"].(string), tunnelprotocol.StreamResetCodeStreamWindowExhausted)
	if summary["avgCreditReturnMs"] != nil {
		t.Fatalf("expected avgCreditReturnMs to be null, got %#v", summary["avgCreditReturnMs"])
	}
	assertEqual(t, summary["creditReturnCount"].(float64), float64(0))
	reset := readControlOfType(t, gatewayConnection, "stream.reset")
	assertEqual(t, reset["streamId"].(float64), float64(8))
	assertEqual(t, reset["code"].(string), tunnelprotocol.StreamResetCodeStreamWindowExhausted)
}

func TestLiveTunnelSessionPublishesAgentStreamWindowThresholdTelemetry(t *testing.T) {
	agentPayload := bytes.Repeat([]byte("x"), 1024*1024)
	agentServer := startLiveSessionTriggeredAgentServer(t, agentPayload)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AgentEndpointURL:        liveSessionWebSocketURL(agentServer),
		Clock:                   timeutil.NewMutableClock(1730000000000),
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":               "telemetry.open.ok",
		"streamId":           float64(SandboxTelemetryLogStreamID),
		"initialWindowBytes": float64(4096),
	})

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(9),
		"channel":  map[string]any{"kind": "agent"},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	encoded, err := tunnelprotocol.EncodeStreamDataFrame(9, tunnelprotocol.PayloadKindWebSocketText, []byte("release"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))

	threshold := readTelemetryRecordOfEvent(t, gatewayConnection, telemetryEventAgentThreshold)
	assertEqual(t, threshold["level"].(string), telemetryLogLevelWarn)
	assertEqual(t, threshold["streamId"].(float64), float64(9))
	assertEqual(t, threshold["channelKind"].(string), "agent")
	assertEqual(t, threshold["payloadKind"].(string), "websocket_binary")
	assertEqual(t, threshold["payloadBytes"].(float64), float64(len(agentPayload)))
	assertEqual(t, threshold["availableBytes"].(float64), float64(tunnelprotocol.AgentStreamWindowBytes-len(agentPayload)))
	assertEqual(t, threshold["outstandingBytes"].(float64), float64(len(agentPayload)))
	assertEqual(t, threshold["thresholdBytes"].(float64), float64(1024*1024))
	assertEqual(t, threshold["maxWindowBytes"].(float64), float64(tunnelprotocol.AgentStreamWindowBytes))
	assertEqual(t, threshold["messageCountOut"].(float64), float64(1))
	assertEqual(t, threshold["streamAgeMs"].(float64), float64(0))
	assertEqual(t, threshold["oldestUnackedMs"].(float64), float64(0))

	frame := liveSessionReadFrame(t, gatewayConnection)
	assertEqual(t, frame.StreamID, uint32(9))
	assertEqual(t, frame.PayloadKind, tunnelprotocol.PayloadKindWebSocketBinary)
	assertEqual(t, bytes.Equal(frame.Payload, agentPayload), true)
}

func TestLiveTunnelSessionCancelsSlowAgentDialWhenGatewayRefreshesStream(t *testing.T) {
	agentListener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	defer agentListener.Close()
	agentURL := "ws://" + agentListener.Addr().String() + "/agent"
	firstAccepted := make(chan struct{}, 1)
	secondAccepted := make(chan *websocket.Conn, 1)
	agentDone := make(chan error, 1)
	go func() {
		firstStream, acceptErr := agentListener.Accept()
		if acceptErr != nil {
			agentDone <- acceptErr
			return
		}
		firstAccepted <- struct{}{}
		defer firstStream.Close()

		server := http.Server{Handler: http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
			connection, websocketErr := websocket.Accept(responseWriter, request, nil)
			if websocketErr != nil {
				agentDone <- websocketErr
				return
			}
			secondAccepted <- connection
			_, _, readErr := connection.Read(context.Background())
			if isExpectedWebSocketClose(readErr) {
				agentDone <- nil
				return
			}
			agentDone <- readErr
		})}
		if serveErr := server.Serve(agentListener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			agentDone <- serveErr
		}
	}()

	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AgentEndpointURL:        agentURL,
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(7),
		"channel":  map[string]any{"kind": "agent"},
	})
	select {
	case <-firstAccepted:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for first hanging agent TCP connection")
	}
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.close",
		"streamId": float64(7),
	})
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(8),
		"channel":  map[string]any{"kind": "agent"},
	})

	select {
	case connection := <-secondAccepted:
		defer connection.CloseNow()
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for second agent websocket connection")
	}
	openOK := readControlOfType(t, gatewayConnection, "stream.open.ok")
	assertEqual(t, openOK["streamId"].(float64), float64(8))
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.close",
		"streamId": float64(8),
	})

	select {
	case err := <-agentDone:
		requireNoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for agent server completion")
	}
}

func TestLiveTunnelSessionAgentDialFailureReturnsOpenErrorWithoutDroppingTunnel(t *testing.T) {
	agentListener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	defer agentListener.Close()
	agentDone := make(chan error, 1)
	go func() {
		connection, acceptErr := agentListener.Accept()
		if acceptErr != nil {
			agentDone <- acceptErr
			return
		}
		agentDone <- connection.Close()
	}()
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AgentEndpointURL:        "ws://" + agentListener.Addr().String() + "/agent",
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(7),
		"channel":  map[string]any{"kind": "agent"},
	})
	openError := readControlOfType(t, gatewayConnection, "stream.open.error")
	assertEqual(t, openError["streamId"].(float64), float64(7))
	assertEqual(t, openError["code"].(string), tunnelprotocol.ConnectErrorCodeAgentEndpointDialFailed)

	readCtx, readCancel := context.WithCancel(context.Background())
	readerDone := make(chan error, 1)
	go func() {
		_, _, err := gatewayConnection.Read(readCtx)
		readerDone <- err
	}()
	pingCtx, pingCancel := context.WithTimeout(context.Background(), 2*time.Second)
	requireNoError(t, gatewayConnection.Ping(pingCtx))
	pingCancel()
	readCancel()
	select {
	case <-readerDone:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for bootstrap ping reader to stop")
	}
	select {
	case <-session.done:
		t.Fatalf("agent dial failure must not close the live tunnel session")
	default:
	}
	select {
	case err := <-agentDone:
		requireNoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for failed agent connection to close")
	}
}

func TestLiveTunnelSessionReportsInvalidBootstrapMessagesAndKeepsTunnelAlive(t *testing.T) {
	agentServer := startLiveSessionAgentServer(t)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AgentEndpointURL:        liveSessionWebSocketURL(agentServer),
		AttachmentRoot:          t.TempDir(),
		Clock:                   timeutil.NewMutableClock(1_730_000_000_000),
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":               "telemetry.open.ok",
		"streamId":           float64(SandboxTelemetryLogStreamID),
		"initialWindowBytes": float64(4096),
	})

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.reset",
		"streamId": float64(99),
		"code":     "unexpected",
		"message":  "unexpected control",
	})
	droppedControl := readTelemetryRecordOfEvent(t, gatewayConnection, telemetryEventControlDropped)
	assertEqual(t, droppedControl["level"].(string), telemetryLogLevelWarn)
	assertEqual(t, droppedControl["message"].(string), `sandboxd dropped bootstrap control message: unsupported stream control message type "stream.reset"`)
	assertEqual(t, droppedControl["reason"].(string), `unsupported stream control message type "stream.reset"`)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, []byte{0x01, 0x02, 0x03}))
	droppedFrame := readTelemetryRecordOfEvent(t, gatewayConnection, telemetryEventFrameDropped)
	assertEqual(t, droppedFrame["level"].(string), telemetryLogLevelWarn)
	assertEqual(t, droppedFrame["message"].(string), "sandboxd dropped bootstrap data frame: data frame must be at least 6 bytes long")
	assertEqual(t, droppedFrame["reason"].(string), "data frame must be at least 6 bytes long")

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(9),
		"channel":  map[string]any{"kind": "agent"},
	})
	openOK := readControlOfType(t, gatewayConnection, "stream.open.ok")
	assertEqual(t, openOK["streamId"].(float64), float64(9))
	agentPayload, err := tunnelprotocol.EncodeStreamDataFrame(9, tunnelprotocol.PayloadKindWebSocketText, []byte("hello-agent"))
	requireNoError(t, err)
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, agentPayload))
	agentFrame := liveSessionReadFrame(t, gatewayConnection)
	assertEqual(t, agentFrame.StreamID, uint32(9))
	assertEqual(t, string(agentFrame.Payload), "hello-gateway")
}

func TestLiveTunnelSessionSendsTelemetryCloseOnSessionClose(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	requireInitialRuntimeReady(t, gatewayConnection, false)

	closeDone := make(chan error, 1)
	go func() {
		closeDone <- session.Close()
	}()
	telemetryClose := readControlOfType(t, gatewayConnection, "telemetry.close")
	assertEqual(t, telemetryClose["streamId"].(float64), float64(SandboxTelemetryLogStreamID))
	select {
	case err := <-closeDone:
		requireNoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for live tunnel session close")
	}
}

func TestLiveTunnelSessionReconnectsAfterGatewayServiceRestartCloseAndRollsExchangeToken(t *testing.T) {
	bootstrapTokens := make(chan string, 2)
	tokenExchangeObserved := make(chan struct{}, 1)
	reconnected := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/token-exchange") {
			assertEqual(t, request.Method, http.MethodPost)
			assertEqual(t, request.URL.Query().Get("x-mistle-test-environment-id"), "test_env_reconnect")
			assertEqual(t, request.Header.Get("Authorization"), "Bearer exchange-token-initial")
			assertEqual(t, request.Header.Get("Content-Length"), "0")
			tokenExchangeObserved <- struct{}{}
			responseWriter.Header().Set("Content-Type", "application/json")
			requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{
				"bootstrapToken":      "bootstrap-token-reconnect-1",
				"tunnelExchangeToken": "exchange-token-reconnect-1",
			}))
			return
		}
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected gateway websocket accept: %v", err)
			return
		}
		bootstrapTokens <- request.URL.Query().Get("bootstrap_token")
		requireRuntimeReadyAndTelemetryOpenOnServer(t, connection, false)
		if request.URL.Query().Get("bootstrap_token") == "bootstrap-token-initial" {
			requireNoError(t, connection.Close(GatewayServiceRestartCloseCode, GatewayServiceRestartCloseReason))
			return
		}
		reconnected <- struct{}{}
		<-request.Context().Done()
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sbi_reconnect?x-mistle-test-environment-id=test_env_reconnect"
	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token-initial")
	requireNoError(t, err)
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		GatewayWSURL:             gatewayURL,
		TunnelExchangeToken:      "exchange-token-initial",
		TunnelExchangeHTTPClient: server.Client(),
		Clock:                    timeutil.SystemClock{},
		KeepaliveManager:         keepalive.NewSharedManager(),
		RuntimeReadinessManager:  &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()

	assertEqual(t, receiveString(t, bootstrapTokens), "bootstrap-token-initial")
	select {
	case <-tokenExchangeObserved:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for token exchange request")
	}
	assertEqual(t, receiveString(t, bootstrapTokens), "bootstrap-token-reconnect-1")
	select {
	case <-reconnected:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for reconnected bootstrap websocket")
	}
}

func TestLiveTunnelSessionPublishesAgentSummaryAfterBootstrapReconnect(t *testing.T) {
	agentServer := startLiveSessionIdleAgentServer(t)
	gatewayConnections := make(chan *websocket.Conn, 2)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/token-exchange") {
			responseWriter.Header().Set("Content-Type", "application/json")
			requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{
				"bootstrapToken":      "bootstrap-token-reconnect-1",
				"tunnelExchangeToken": "exchange-token-reconnect-1",
			}))
			return
		}
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected gateway websocket accept: %v", err)
			return
		}
		connection.SetReadLimit(tunnelWebSocketReadLimitBytes)
		gatewayConnections <- connection
		<-request.Context().Done()
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sbi_reconnect_agent_summary"
	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token-initial")
	requireNoError(t, err)
	initialConnection := <-gatewayConnections
	clock := timeutil.NewMutableClock(1730000000000)
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AgentEndpointURL:         liveSessionWebSocketURL(agentServer),
		GatewayWSURL:             gatewayURL,
		TunnelExchangeToken:      "exchange-token-initial",
		TunnelExchangeHTTPClient: server.Client(),
		Clock:                    clock,
		KeepaliveManager:         keepalive.NewSharedManager(),
		RuntimeReadinessManager:  &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, initialConnection, false)
	liveSessionWriteJSON(t, initialConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(17),
		"channel":  map[string]any{"kind": "agent"},
	})
	openOK := liveSessionReadJSON(t, initialConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	clock.AdvanceMS(250)
	requireNoError(t, initialConnection.Close(GatewayServiceRestartCloseCode, GatewayServiceRestartCloseReason))

	reconnectedConnection := <-gatewayConnections
	requireInitialRuntimeReady(t, reconnectedConnection, false)
	liveSessionWriteJSON(t, reconnectedConnection, map[string]any{
		"type":               "telemetry.open.ok",
		"streamId":           float64(SandboxTelemetryLogStreamID),
		"initialWindowBytes": float64(4096),
	})
	summary := readTelemetryRecordOfEvent(t, reconnectedConnection, telemetryEventAgentSummary)
	assertEqual(t, summary["streamId"].(float64), float64(17))
	assertEqual(t, summary["channelKind"].(string), "agent")
	assertEqual(t, summary["outcome"].(string), "bootstrap_closed")
	assertEqual(t, summary["closeSource"].(string), "bootstrap")
	assertEqual(t, summary["durationMs"].(float64), float64(250))
	assertEqual(t, summary["messageCountOut"].(float64), float64(0))
	assertEqual(t, summary["messageCountIn"].(float64), float64(0))
	if summary["resetCode"] != nil {
		t.Fatalf("expected resetCode to be null, got %#v", summary["resetCode"])
	}
	if !strings.Contains(summary["reason"].(string), GatewayServiceRestartCloseReason) {
		t.Fatalf("expected bootstrap close reason to mention %q, got %q", GatewayServiceRestartCloseReason, summary["reason"].(string))
	}
}

func TestLiveTunnelSessionDoesNotReconnectAfterNearMissGatewayServiceRestartClose(t *testing.T) {
	tokenExchangeObserved := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/token-exchange") {
			tokenExchangeObserved <- struct{}{}
			responseWriter.WriteHeader(http.StatusConflict)
			return
		}
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected gateway websocket accept: %v", err)
			return
		}
		requireRuntimeReadyAndTelemetryOpenOnServer(t, connection, false)
		requireNoError(t, connection.Close(websocket.StatusGoingAway, GatewayServiceRestartCloseReason))
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sbi_reconnect_near_miss"
	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token-initial")
	requireNoError(t, err)
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		GatewayWSURL:             gatewayURL,
		TunnelExchangeToken:      "exchange-token-initial",
		TunnelExchangeHTTPClient: server.Client(),
		Clock:                    timeutil.SystemClock{},
		KeepaliveManager:         keepalive.NewSharedManager(),
		RuntimeReadinessManager:  &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()

	select {
	case <-session.done:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for near-miss close to end the session")
	}
	select {
	case <-tokenExchangeObserved:
		t.Fatalf("near-miss service restart close must not request token exchange")
	case <-time.After(150 * time.Millisecond):
	}
}

func TestLiveTunnelSessionBootstrapDisconnectLeavesPublishManagersDisconnected(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	clock := timeutil.NewMutableClock(1_000)
	keepaliveManager := keepalive.NewSharedManager()
	runtimeReadinessManager := &readiness.Manager{}
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   clock,
		KeepaliveManager:        keepaliveManager,
		RuntimeReadinessManager: runtimeReadinessManager,
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	keepaliveState := readControlOfType(t, gatewayConnection, "keepalive.state")
	assertEqual(t, keepaliveState["active"].(bool), false)

	requireNoError(t, gatewayConnection.Close(websocket.StatusNormalClosure, ""))
	select {
	case <-session.done:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for bootstrap disconnect to close the live tunnel session")
	}
	keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
		manager.SetPlatformActive(true)
		if state := manager.TakePublishableState(clock); state != nil {
			t.Fatalf("expected disconnected keepalive manager not to publish, got %#v", state)
		}
	})
	runtimeReadinessManager.SetReady(true)
	if state := runtimeReadinessManager.TakePublishableState(); state != nil {
		t.Fatalf("expected disconnected readiness manager not to publish, got %#v", state)
	}
}

func TestLiveTunnelSessionGatewayServiceRestartClosesActivePortAccessTCPStreams(t *testing.T) {
	upstream, upstreamDone := startPortAccessObservedIdleTCPServer(t)
	defer upstream.Close()
	_, portText, err := net.SplitHostPort(upstream.Addr().String())
	requireNoError(t, err)
	port, err := strconv.ParseUint(portText, 10, 16)
	requireNoError(t, err)
	gatewayConnections := make(chan *websocket.Conn, 2)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/token-exchange") {
			responseWriter.Header().Set("Content-Type", "application/json")
			requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{
				"bootstrapToken":      "bootstrap-token-reconnect-1",
				"tunnelExchangeToken": "exchange-token-reconnect-1",
			}))
			return
		}
		connection, websocketErr := websocket.Accept(responseWriter, request, nil)
		if websocketErr != nil {
			t.Errorf("expected gateway websocket accept: %v", websocketErr)
			return
		}
		gatewayConnections <- connection
		<-request.Context().Done()
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sbi_reconnect_port_access"
	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token-initial")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		GatewayWSURL:             gatewayURL,
		TunnelExchangeToken:      "exchange-token-initial",
		TunnelExchangeHTTPClient: server.Client(),
		Clock:                    timeutil.SystemClock{},
		KeepaliveManager:         keepalive.NewSharedManager(),
		RuntimeReadinessManager:  &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":             "ports.tcp.open",
		"streamId":         float64(60),
		"upstreamProtocol": "http",
		"target": map[string]any{
			"kind": "port",
			"port": float64(port),
		},
	})
	connected := readControlOfType(t, gatewayConnection, "ports.tcp.connected")
	assertEqual(t, connected["streamId"].(float64), float64(60))
	requireNoError(t, gatewayConnection.Close(GatewayServiceRestartCloseCode, GatewayServiceRestartCloseReason))
	select {
	case err := <-upstreamDone:
		requireNoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for active port access tcp stream to close")
	}
	select {
	case <-gatewayConnections:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for bootstrap reconnect after service restart")
	}
}

func TestLiveTunnelSessionFailsPendingEgressTokenRequestWhenBootstrapRestarts(t *testing.T) {
	egressRequestSeen := make(chan struct{}, 1)
	reconnected := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/token-exchange") {
			assertEqual(t, request.Header.Get("Authorization"), "Bearer exchange-token-initial")
			responseWriter.Header().Set("Content-Type", "application/json")
			requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{
				"bootstrapToken":      "bootstrap-token-reconnect-1",
				"tunnelExchangeToken": "exchange-token-reconnect-1",
			}))
			return
		}
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected gateway websocket accept: %v", err)
			return
		}
		requireRuntimeReadyAndTelemetryOpenOnServer(t, connection, false)
		if request.URL.Query().Get("bootstrap_token") == "bootstrap-token-initial" {
			egressRequest := readControlOfType(t, connection, "egress.token.request")
			assertEqual(t, egressRequest["requestId"].(string), "egress_token_req_1")
			egressRequestSeen <- struct{}{}
			requireNoError(t, connection.Close(GatewayServiceRestartCloseCode, GatewayServiceRestartCloseReason))
			return
		}
		reconnected <- struct{}{}
		<-request.Context().Done()
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sbi_reconnect_pending_egress"
	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token-initial")
	requireNoError(t, err)
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		GatewayWSURL:             gatewayURL,
		TunnelExchangeToken:      "exchange-token-initial",
		TunnelExchangeHTTPClient: server.Client(),
		Clock:                    timeutil.SystemClock{},
		KeepaliveManager:         keepalive.NewSharedManager(),
		RuntimeReadinessManager:  &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()

	result := make(chan string, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, err := session.RequestEgressToken(ctx, nil)
		if err != nil {
			result <- err.Error()
			return
		}
		result <- "unexpected success"
	}()

	select {
	case <-egressRequestSeen:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for egress token request")
	}
	assertEqual(t, receiveString(t, result), "bootstrap tunnel session restarted before an egress token arrived")
	select {
	case <-reconnected:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for reconnect after egress request failure")
	}
}

func TestLiveTunnelSessionFailsPendingSigningRequestWhenBootstrapRestarts(t *testing.T) {
	signingRequestSeen := make(chan struct{}, 1)
	reconnected := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/token-exchange") {
			assertEqual(t, request.Header.Get("Authorization"), "Bearer exchange-token-initial")
			responseWriter.Header().Set("Content-Type", "application/json")
			requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{
				"bootstrapToken":      "bootstrap-token-reconnect-1",
				"tunnelExchangeToken": "exchange-token-reconnect-1",
			}))
			return
		}
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected gateway websocket accept: %v", err)
			return
		}
		requireRuntimeReadyAndTelemetryOpenOnServer(t, connection, false)
		if request.URL.Query().Get("bootstrap_token") == "bootstrap-token-initial" {
			signingRequest := readControlOfType(t, connection, "signing.request")
			assertEqual(t, signingRequest["requestId"].(string), "sign_req_restart")
			signingRequestSeen <- struct{}{}
			requireNoError(t, connection.Close(GatewayServiceRestartCloseCode, GatewayServiceRestartCloseReason))
			return
		}
		reconnected <- struct{}{}
		<-request.Context().Done()
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sbi_reconnect_pending_signing"
	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token-initial")
	requireNoError(t, err)
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		GatewayWSURL:             gatewayURL,
		TunnelExchangeToken:      "exchange-token-initial",
		TunnelExchangeHTTPClient: server.Client(),
		Clock:                    timeutil.SystemClock{},
		KeepaliveManager:         keepalive.NewSharedManager(),
		RuntimeReadinessManager:  &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()

	result := make(chan string, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, err := session.RequestSigning(ctx, `{"type":"signing.request","requestId":"sign_req_restart","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","format":"ssh","keyRef":"key","grant":"grant","payload":"cGF5bG9hZA==","encoding":"base64"}`)
		if err != nil {
			result <- err.Error()
			return
		}
		result <- "unexpected success"
	}()

	select {
	case <-signingRequestSeen:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for signing request")
	}
	assertEqual(t, receiveString(t, result), "bootstrap tunnel session restarted before a signing result arrived")
	select {
	case <-reconnected:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for reconnect after signing request failure")
	}
}

func TestLiveTunnelSessionRetriesRetryableTokenExchangeFailureThenReconnects(t *testing.T) {
	restoreReconnectBackoff := useTestReconnectBackoff([]time.Duration{time.Millisecond})
	defer restoreReconnectBackoff()
	tokenExchangeAttempts := make(chan string, 2)
	reconnected := make(chan struct{}, 1)
	var exchangeAttemptCounter atomic.Uint32
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/token-exchange") {
			tokenExchangeAttempts <- request.Header.Get("Authorization")
			if exchangeAttemptCounter.Add(1) == 1 {
				responseWriter.WriteHeader(http.StatusTooManyRequests)
				requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{"error": "retry later"}))
				return
			}
			responseWriter.Header().Set("Content-Type", "application/json")
			requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{
				"bootstrapToken":      "bootstrap-token-retry-success",
				"tunnelExchangeToken": "exchange-token-retry-success",
			}))
			return
		}
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected gateway websocket accept: %v", err)
			return
		}
		requireRuntimeReadyAndTelemetryOpenOnServer(t, connection, false)
		if request.URL.Query().Get("bootstrap_token") == "bootstrap-token-initial" {
			requireNoError(t, connection.Close(GatewayServiceRestartCloseCode, GatewayServiceRestartCloseReason))
			return
		}
		assertEqual(t, request.URL.Query().Get("bootstrap_token"), "bootstrap-token-retry-success")
		reconnected <- struct{}{}
		<-request.Context().Done()
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sbi_reconnect_retryable_exchange"
	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token-initial")
	requireNoError(t, err)
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		GatewayWSURL:             gatewayURL,
		TunnelExchangeToken:      "exchange-token-initial",
		TunnelExchangeHTTPClient: server.Client(),
		Clock:                    timeutil.SystemClock{},
		KeepaliveManager:         keepalive.NewSharedManager(),
		RuntimeReadinessManager:  &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()

	assertEqual(t, receiveString(t, tokenExchangeAttempts), "Bearer exchange-token-initial")
	assertEqual(t, receiveString(t, tokenExchangeAttempts), "Bearer exchange-token-initial")
	select {
	case <-reconnected:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for reconnect after retryable token exchange failure")
	}
}

func TestLiveTunnelSessionRetriesMalformedTokenExchangeSuccessThenReconnects(t *testing.T) {
	restoreReconnectBackoff := useTestReconnectBackoff([]time.Duration{time.Millisecond})
	defer restoreReconnectBackoff()
	tokenExchangeAttempts := make(chan string, 2)
	reconnected := make(chan struct{}, 1)
	var exchangeAttemptCounter atomic.Uint32
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/token-exchange") {
			tokenExchangeAttempts <- request.Header.Get("Authorization")
			responseWriter.Header().Set("Content-Type", "application/json")
			if exchangeAttemptCounter.Add(1) == 1 {
				_, err := responseWriter.Write([]byte(`{"bootstrapToken":"bootstrap-token-reconnect"`))
				requireNoError(t, err)
				return
			}
			requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{
				"bootstrapToken":      "bootstrap-token-after-malformed-exchange",
				"tunnelExchangeToken": "exchange-token-after-malformed-exchange",
			}))
			return
		}
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected gateway websocket accept: %v", err)
			return
		}
		requireRuntimeReadyAndTelemetryOpenOnServer(t, connection, false)
		if request.URL.Query().Get("bootstrap_token") == "bootstrap-token-initial" {
			requireNoError(t, connection.Close(GatewayServiceRestartCloseCode, GatewayServiceRestartCloseReason))
			return
		}
		assertEqual(t, request.URL.Query().Get("bootstrap_token"), "bootstrap-token-after-malformed-exchange")
		reconnected <- struct{}{}
		<-request.Context().Done()
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sbi_reconnect_malformed_exchange"
	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token-initial")
	requireNoError(t, err)
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		GatewayWSURL:             gatewayURL,
		TunnelExchangeToken:      "exchange-token-initial",
		TunnelExchangeHTTPClient: server.Client(),
		Clock:                    timeutil.SystemClock{},
		KeepaliveManager:         keepalive.NewSharedManager(),
		RuntimeReadinessManager:  &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()

	assertEqual(t, receiveString(t, tokenExchangeAttempts), "Bearer exchange-token-initial")
	assertEqual(t, receiveString(t, tokenExchangeAttempts), "Bearer exchange-token-initial")
	select {
	case <-reconnected:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for reconnect after malformed token exchange success")
	}
}

func TestLiveTunnelSessionRetriesReconnectWebSocketFailureWithRolledExchangeToken(t *testing.T) {
	restoreReconnectBackoff := useTestReconnectBackoff([]time.Duration{time.Millisecond})
	defer restoreReconnectBackoff()
	tokenExchangeAttempts := make(chan string, 2)
	reconnectBootstrapTokens := make(chan string, 2)
	forwardedLifecycleEvents := make(chan map[string]any, 3)
	reconnected := make(chan struct{}, 1)
	var exchangeAttemptCounter atomic.Uint32
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/token-exchange") {
			tokenExchangeAttempts <- request.Header.Get("Authorization")
			responseWriter.Header().Set("Content-Type", "application/json")
			if exchangeAttemptCounter.Add(1) == 1 {
				requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{
					"bootstrapToken":      "bootstrap-token-reconnect-dial-fails",
					"tunnelExchangeToken": "exchange-token-after-failed-reconnect-dial",
				}))
				return
			}
			requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{
				"bootstrapToken":      "bootstrap-token-reconnect-success",
				"tunnelExchangeToken": "exchange-token-reconnect-success",
			}))
			return
		}
		bootstrapToken := request.URL.Query().Get("bootstrap_token")
		if bootstrapToken == "bootstrap-token-reconnect-dial-fails" {
			reconnectBootstrapTokens <- bootstrapToken
			http.Error(responseWriter, "reconnect websocket unavailable", http.StatusServiceUnavailable)
			return
		}
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected gateway websocket accept: %v", err)
			return
		}
		requireRuntimeReadyAndTelemetryOpenOnServer(t, connection, false)
		if bootstrapToken == "bootstrap-token-initial" {
			requireNoError(t, connection.Close(GatewayServiceRestartCloseCode, GatewayServiceRestartCloseReason))
			return
		}
		assertEqual(t, bootstrapToken, "bootstrap-token-reconnect-success")
		reconnectBootstrapTokens <- bootstrapToken
		liveSessionWriteJSON(t, connection, map[string]any{
			"type":               "telemetry.open.ok",
			"streamId":           float64(SandboxTelemetryLogStreamID),
			"initialWindowBytes": float64(4096),
		})
		forwardedLifecycleEvents <- readTelemetryRecordOfEvent(t, connection, "component_healthcheck_failed")
		forwardedLifecycleEvents <- readTelemetryRecordOfEvent(t, connection, "component_restart_scheduled")
		forwardedLifecycleEvents <- readTelemetryRecordOfEvent(t, connection, "component_restart_succeeded")
		reconnected <- struct{}{}
		<-request.Context().Done()
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sbi_reconnect_dial_failure"
	clock := timeutil.NewMutableClock(1_000)
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sbi_reconnect_dial_failure",
		clock,
		[]supervision.SupervisedComponent{supervision.ComponentTunnelSession},
	)
	requireNoError(t, err)
	supervisorHandle.ReplaceComponentDetails(supervision.ComponentTunnelSession, map[string]string{"gatewayWsUrl": gatewayURL})
	supervisorHandle.MarkComponentStarting(supervision.ComponentTunnelSession)
	supervisorHandle.MarkComponentHealthy(supervision.ComponentTunnelSession)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token-initial")
	requireNoError(t, err)
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		GatewayWSURL:             gatewayURL,
		TunnelExchangeToken:      "exchange-token-initial",
		TunnelExchangeHTTPClient: server.Client(),
		Clock:                    clock,
		KeepaliveManager:         keepalive.NewSharedManager(),
		RuntimeReadinessManager:  &readiness.Manager{},
		SupervisorHandle:         supervisorHandle,
	})
	requireNoError(t, err)
	defer session.Close()

	assertEqual(t, receiveString(t, tokenExchangeAttempts), "Bearer exchange-token-initial")
	assertEqual(t, receiveString(t, reconnectBootstrapTokens), "bootstrap-token-reconnect-dial-fails")
	assertEqual(t, receiveString(t, tokenExchangeAttempts), "Bearer exchange-token-after-failed-reconnect-dial")
	assertEqual(t, receiveString(t, reconnectBootstrapTokens), "bootstrap-token-reconnect-success")
	select {
	case <-reconnected:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for reconnect after failed reconnect websocket dial")
	}
	snapshot := supervisorHandle.ComponentSnapshot(supervision.ComponentTunnelSession)
	if snapshot == nil {
		t.Fatalf("expected tunnel supervisor snapshot")
	}
	assertEqual(t, snapshot.State, supervision.ComponentHealthy)
	assertEqual(t, snapshot.RestartCount, uint64(1))
	assertEqual(t, snapshot.Details["gatewayWsUrl"], gatewayURL)
	if _, exists := snapshot.Details["lastReconnectReason"]; exists {
		t.Fatalf("expected successful reconnect to clear lastReconnectReason, got %#v", snapshot.Details)
	}
	healthcheckFailed := receiveTelemetryRecord(t, forwardedLifecycleEvents)
	assertEqual(t, healthcheckFailed["level"].(string), telemetryLogLevelWarn)
	assertEqual(t, healthcheckFailed["reason"].(string), "bootstrap_connect_failed")
	restartScheduled := receiveTelemetryRecord(t, forwardedLifecycleEvents)
	assertEqual(t, restartScheduled["level"].(string), telemetryLogLevelWarn)
	assertEqual(t, restartScheduled["reason"].(string), "retry_after_failure")
	assertEqual(t, restartScheduled["backoffMs"].(float64), float64(1))
	restartSucceeded := receiveTelemetryRecord(t, forwardedLifecycleEvents)
	assertEqual(t, restartSucceeded["level"].(string), telemetryLogLevelInfo)
	assertEqual(t, restartSucceeded["reason"].(string), "restart_succeeded")
}

func TestLiveTunnelSessionStopsReconnectWhenTokenExchangeReturnsTerminalStatus(t *testing.T) {
	for _, statusCode := range []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusConflict} {
		t.Run(http.StatusText(statusCode), func(t *testing.T) {
			restoreReconnectBackoff := useTestReconnectBackoff([]time.Duration{time.Millisecond})
			defer restoreReconnectBackoff()
			tokenExchangeObserved := make(chan struct{}, 1)
			reconnectAttempted := make(chan struct{}, 1)
			server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
				if strings.HasSuffix(request.URL.Path, "/token-exchange") {
					tokenExchangeObserved <- struct{}{}
					responseWriter.WriteHeader(statusCode)
					requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{"error": "terminal exchange"}))
					return
				}
				connection, err := websocket.Accept(responseWriter, request, nil)
				if err != nil {
					t.Errorf("expected gateway websocket accept: %v", err)
					return
				}
				requireRuntimeReadyAndTelemetryOpenOnServer(t, connection, false)
				if request.URL.Query().Get("bootstrap_token") == "bootstrap-token-initial" {
					requireNoError(t, connection.Close(GatewayServiceRestartCloseCode, GatewayServiceRestartCloseReason))
					return
				}
				reconnectAttempted <- struct{}{}
			}))
			defer server.Close()
			gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sbi_reconnect_terminal_exchange"
			tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token-initial")
			requireNoError(t, err)
			session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
				GatewayWSURL:             gatewayURL,
				TunnelExchangeToken:      "exchange-token-initial",
				TunnelExchangeHTTPClient: server.Client(),
				Clock:                    timeutil.SystemClock{},
				KeepaliveManager:         keepalive.NewSharedManager(),
				RuntimeReadinessManager:  &readiness.Manager{},
			})
			requireNoError(t, err)
			defer session.Close()

			select {
			case <-tokenExchangeObserved:
			case <-time.After(2 * time.Second):
				t.Fatalf("timed out waiting for terminal token exchange request")
			}
			select {
			case <-session.done:
			case <-time.After(2 * time.Second):
				t.Fatalf("timed out waiting for terminal token exchange to stop session")
			}
			select {
			case <-reconnectAttempted:
				t.Fatalf("terminal token exchange must not reconnect")
			case <-time.After(150 * time.Millisecond):
			}
		})
	}
}

func TestLiveTunnelSessionRoutesSigningResultsToPendingRequest(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	result := make(chan string, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		payload, err := session.RequestSigning(ctx, `{"type":"signing.request","requestId":"sign_req_123","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","format":"ssh","keyRef":"key","grant":"grant","payload":"cGF5bG9hZA==","encoding":"base64"}`)
		if err != nil {
			result <- "error: " + err.Error()
			return
		}
		result <- payload
	}()

	request := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, request["type"].(string), "signing.request")
	assertEqual(t, request["requestId"].(string), "sign_req_123")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "signing.result",
		"requestId": "sign_req_123",
		"ok":        true,
		"signature": "c2lnbmF0dXJl",
		"encoding":  "base64",
	})

	select {
	case payload := <-result:
		assertEqual(t, payload, `{"encoding":"base64","ok":true,"requestId":"sign_req_123","signature":"c2lnbmF0dXJl","type":"signing.result"}`)
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for signing response")
	}
}

func TestLiveTunnelSessionReturnsAuthorizationFailuresFromGatewaySigningResults(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	result := make(chan string, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		payload, err := session.RequestSigning(ctx, `{"type":"signing.request","requestId":"sign_req_123","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","format":"ssh","keyRef":"key","grant":"grant","payload":"cGF5bG9hZA==","encoding":"base64"}`)
		if err != nil {
			result <- "error: " + err.Error()
			return
		}
		result <- payload
	}()

	request := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, request["type"].(string), "signing.request")
	assertEqual(t, request["requestId"].(string), "sign_req_123")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "signing.result",
		"requestId": "sign_req_123",
		"ok":        false,
		"code":      "invalid_grant",
		"message":   "Signing grant verification failed: token_invalid.",
	})

	select {
	case payload := <-result:
		assertEqual(t, payload, `{"code":"invalid_grant","message":"Signing grant verification failed: token_invalid.","ok":false,"requestId":"sign_req_123","type":"signing.result"}`)
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for signing authorization failure")
	}
}

func TestLiveTunnelSessionRoutesEgressTokenResponsesToPendingRequest(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	result := make(chan string, 1)
	actingUserID := "usr_123"
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		token, err := session.RequestEgressToken(ctx, &actingUserID)
		if err != nil {
			result <- "error: " + err.Error()
			return
		}
		result <- token
	}()

	request := readControlOfType(t, gatewayConnection, "egress.token.request")
	assertEqual(t, request["requestId"].(string), "egress_token_req_1")
	assertEqual(t, request["actingUserId"].(string), "usr_123")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "egress.token.response",
		"requestId": "egress_token_req_1",
		"token":     "jwt-token",
		"expiresAt": "2026-01-02T03:04:05Z",
		"ttlMs":     float64(60000),
	})

	select {
	case token := <-result:
		assertEqual(t, token, "jwt-token")
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for egress token response")
	}
}

func TestLiveTunnelEgressTokenProviderCachesTokensUntilRelativeTTLExpires(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	clock := timeutil.NewMutableClock(1_700_000_000_000)
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   clock,
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	provider := session.EgressTokenProvider(nil)

	firstResult := make(chan string, 1)
	go func() {
		token, tokenErr := provider.Token()
		if tokenErr != nil {
			firstResult <- "error: " + tokenErr.Error()
			return
		}
		firstResult <- token.Token
	}()
	firstRequest := readControlOfType(t, gatewayConnection, "egress.token.request")
	assertEqual(t, firstRequest["requestId"].(string), "egress_token_req_1")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "egress.token.response",
		"requestId": "egress_token_req_1",
		"token":     "short-lived-egress-jwt-1",
		"expiresAt": "2100-01-01T00:00:00Z",
		"ttlMs":     float64(10),
	})
	select {
	case token := <-firstResult:
		assertEqual(t, token, "short-lived-egress-jwt-1")
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for first egress token")
	}

	cachedToken, err := provider.Token()
	requireNoError(t, err)
	assertEqual(t, cachedToken.Token, "short-lived-egress-jwt-1")

	clock.AdvanceMS(11)
	secondResult := make(chan string, 1)
	go func() {
		token, tokenErr := provider.Token()
		if tokenErr != nil {
			secondResult <- "error: " + tokenErr.Error()
			return
		}
		secondResult <- token.Token
	}()
	secondRequest := readControlOfType(t, gatewayConnection, "egress.token.request")
	assertEqual(t, secondRequest["requestId"].(string), "egress_token_req_2")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "egress.token.response",
		"requestId": "egress_token_req_2",
		"token":     "short-lived-egress-jwt-2",
		"expiresAt": "2100-01-01T00:00:00Z",
		"ttlMs":     float64(10),
	})
	select {
	case token := <-secondResult:
		assertEqual(t, token, "short-lived-egress-jwt-2")
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for refreshed egress token")
	}
}

func TestLiveTunnelEgressTokenProviderActingUserUpdateClearsCachedToken(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.NewMutableClock(1_700_000_000_000),
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	initialActor := "usr_initial"
	provider := session.EgressTokenProvider(&initialActor)

	firstResult := make(chan string, 1)
	go func() {
		token, tokenErr := provider.Token()
		if tokenErr != nil {
			firstResult <- "error: " + tokenErr.Error()
			return
		}
		firstResult <- token.Token
	}()
	firstRequest := readControlOfType(t, gatewayConnection, "egress.token.request")
	assertEqual(t, firstRequest["requestId"].(string), "egress_token_req_1")
	assertEqual(t, firstRequest["actingUserId"].(string), "usr_initial")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "egress.token.response",
		"requestId": "egress_token_req_1",
		"token":     "egress-jwt-usr_initial",
		"expiresAt": "2100-01-01T00:00:00Z",
		"ttlMs":     float64(300000),
	})
	assertEqual(t, receiveString(t, firstResult), "egress-jwt-usr_initial")

	resumedActor := "usr_resumed"
	requireNoError(t, provider.SetActingUserID(&resumedActor))
	secondResult := make(chan string, 1)
	go func() {
		token, tokenErr := provider.Token()
		if tokenErr != nil {
			secondResult <- "error: " + tokenErr.Error()
			return
		}
		secondResult <- token.Token
	}()
	secondRequest := readControlOfType(t, gatewayConnection, "egress.token.request")
	assertEqual(t, secondRequest["requestId"].(string), "egress_token_req_2")
	assertEqual(t, secondRequest["actingUserId"].(string), "usr_resumed")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "egress.token.response",
		"requestId": "egress_token_req_2",
		"token":     "egress-jwt-usr_resumed",
		"expiresAt": "2100-01-01T00:00:00Z",
		"ttlMs":     float64(300000),
	})
	assertEqual(t, receiveString(t, secondResult), "egress-jwt-usr_resumed")
}

func TestLiveTunnelEgressTokenProviderDetachClearsCachedTokenAndSuspendsRequests(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.NewMutableClock(1_700_000_000_000),
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	actingUserID := "usr_initial"
	provider := session.EgressTokenProvider(&actingUserID)

	firstResult := make(chan string, 1)
	go func() {
		token, tokenErr := provider.Token()
		if tokenErr != nil {
			firstResult <- "error: " + tokenErr.Error()
			return
		}
		firstResult <- token.Token
	}()
	firstRequest := readControlOfType(t, gatewayConnection, "egress.token.request")
	assertEqual(t, firstRequest["requestId"].(string), "egress_token_req_1")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "egress.token.response",
		"requestId": "egress_token_req_1",
		"token":     "egress-jwt-usr_initial",
		"expiresAt": "2100-01-01T00:00:00Z",
		"ttlMs":     float64(300000),
	})
	assertEqual(t, receiveString(t, firstResult), "egress-jwt-usr_initial")

	requireNoError(t, provider.Detach())
	_, detachedErr := provider.Token()
	if detachedErr == nil || !strings.Contains(detachedErr.Error(), "gateway egress token provider is not attached") {
		t.Fatalf("expected detached token provider error, got %v", detachedErr)
	}
}

func TestLiveTunnelEgressTokenProviderRejectsInFlightResponseAfterActorChange(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.NewMutableClock(1_700_000_000_000),
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	initialActor := "usr_initial"
	provider := session.EgressTokenProvider(&initialActor)

	firstResult := make(chan string, 1)
	go func() {
		token, tokenErr := provider.Token()
		if tokenErr != nil {
			firstResult <- tokenErr.Error()
			return
		}
		firstResult <- token.Token
	}()
	firstRequest := readControlOfType(t, gatewayConnection, "egress.token.request")
	assertEqual(t, firstRequest["requestId"].(string), "egress_token_req_1")
	assertEqual(t, firstRequest["actingUserId"].(string), "usr_initial")
	resumedActor := "usr_resumed"
	requireNoError(t, provider.SetActingUserID(&resumedActor))
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "egress.token.response",
		"requestId": "egress_token_req_1",
		"token":     "egress-jwt-usr_initial",
		"expiresAt": "2100-01-01T00:00:00Z",
		"ttlMs":     float64(300000),
	})
	if result := receiveString(t, firstResult); !strings.Contains(result, "provider generation changed") {
		t.Fatalf("expected stale response to be rejected after generation change, got %q", result)
	}

	secondResult := make(chan string, 1)
	go func() {
		token, tokenErr := provider.Token()
		if tokenErr != nil {
			secondResult <- "error: " + tokenErr.Error()
			return
		}
		secondResult <- token.Token
	}()
	secondRequest := readControlOfType(t, gatewayConnection, "egress.token.request")
	assertEqual(t, secondRequest["requestId"].(string), "egress_token_req_2")
	assertEqual(t, secondRequest["actingUserId"].(string), "usr_resumed")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "egress.token.response",
		"requestId": "egress_token_req_2",
		"token":     "egress-jwt-usr_resumed",
		"expiresAt": "2100-01-01T00:00:00Z",
		"ttlMs":     float64(300000),
	})
	assertEqual(t, receiveString(t, secondResult), "egress-jwt-usr_resumed")
}

func TestLiveTunnelSessionRoutesEgressTokenErrorsToPendingRequest(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	result := make(chan string, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, err := session.RequestEgressToken(ctx, nil)
		if err != nil {
			result <- err.Error()
			return
		}
		result <- "unexpected success"
	}()

	request := readControlOfType(t, gatewayConnection, "egress.token.request")
	assertEqual(t, request["requestId"].(string), "egress_token_req_1")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "egress.token.error",
		"requestId": "egress_token_req_1",
		"code":      "forbidden",
		"message":   "not allowed",
	})

	select {
	case errText := <-result:
		assertEqual(t, errText, "forbidden: not allowed")
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for egress token error")
	}
}

func TestLiveTunnelSessionPublishesEgressTokenTelemetry(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.NewMutableClock(1730000000000),
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":               "telemetry.open.ok",
		"streamId":           float64(SandboxTelemetryLogStreamID),
		"initialWindowBytes": float64(4096),
	})

	result := make(chan string, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		token, err := session.RequestEgressToken(ctx, nil)
		if err != nil {
			result <- "error: " + err.Error()
			return
		}
		result <- token
	}()

	request, startedRecord := readControlAndTelemetryEvent(t, gatewayConnection, "egress.token.request", telemetryEventEgressStarted)
	assertEqual(t, request["requestId"].(string), "egress_token_req_1")
	assertEqual(t, startedRecord["level"].(string), telemetryLogLevelInfo)
	assertEqual(t, startedRecord["component"].(string), "TunnelSession")
	assertEqual(t, startedRecord["sandboxInstanceId"].(string), "sbi_123")
	assertEqual(t, startedRecord["requestId"].(string), "egress_token_req_1")

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "egress.token.response",
		"requestId": "egress_token_req_1",
		"token":     "jwt-token",
		"expiresAt": "2026-01-02T03:04:05Z",
		"ttlMs":     float64(60000),
	})
	completedRecord := readTelemetryRecordOfEvent(t, gatewayConnection, telemetryEventEgressCompleted)
	assertEqual(t, completedRecord["level"].(string), telemetryLogLevelInfo)
	assertEqual(t, completedRecord["expiresAt"].(string), "2026-01-02T03:04:05Z")
	assertEqual(t, completedRecord["ttlMs"].(float64), float64(60000))

	select {
	case token := <-result:
		assertEqual(t, token, "jwt-token")
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for egress token response")
	}
}

func TestLiveTunnelSessionRejectsStreamSignalOnBootstrapTunnel(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.signal",
		"streamId": float64(9),
		"signal": map[string]any{
			"type": "pty.resize",
			"cols": float64(120),
			"rows": float64(40),
		},
	})

	reset := readControlOfType(t, gatewayConnection, "stream.reset")
	assertEqual(t, reset["streamId"].(float64), float64(9))
	assertEqual(t, reset["code"].(string), tunnelprotocol.StreamResetCodeInvalidStreamSignal)
	assertEqual(t, reset["message"].(string), "stream.signal is not supported on bootstrap tunnel streams")
}

func TestLiveTunnelSessionOpensDirectPTYTransport(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	ptyTransportServer, ptyTransportConnections := startPTYTransportServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":           "pty.session.open",
		"requestId":      "pty_req_1",
		"ptySessionId":   "pty_123",
		"transportUrl":   liveSessionWebSocketURL(ptyTransportServer),
		"transportToken": "transport-token",
		"launch": map[string]any{
			"session": "create",
			"command": "/bin/sh",
			"args":    []string{"-lc", "printf 'direct-pty-ready'; sleep 30"},
		},
	})

	ptyTransportConnection := <-ptyTransportConnections
	opened := readControlOfType(t, gatewayConnection, "pty.session.opened")
	assertEqual(t, opened["requestId"].(string), "pty_req_1")
	assertEqual(t, opened["ptySessionId"].(string), "pty_123")
	output := readPTYTransportBinaryContaining(t, ptyTransportConnection, "direct-pty-ready")
	if !strings.Contains(output, "direct-pty-ready") {
		t.Fatalf("expected direct pty output, got %q", output)
	}
	liveSessionWriteJSON(t, ptyTransportConnection, map[string]any{
		"type":     "stream.close",
		"streamId": float64(1),
	})
	exit := readPTYTransportEvent(t, ptyTransportConnection, "pty.exit")
	assertEqual(t, exit["streamId"].(float64), float64(1))
	event := exit["event"].(map[string]any)
	assertEqual(t, event["type"].(string), "pty.exit")
}

func TestLiveTunnelSessionRejectsDirectPTYAttach(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":           "pty.session.open",
		"requestId":      "pty_req_attach",
		"ptySessionId":   "pty_attach",
		"transportUrl":   "ws://127.0.0.1:1/pty",
		"transportToken": "transport-token",
		"launch": map[string]any{
			"session": "attach",
		},
	})

	failure := readControlOfType(t, gatewayConnection, "pty.session.error")
	assertEqual(t, failure["requestId"].(string), "pty_req_attach")
	assertEqual(t, failure["ptySessionId"].(string), "pty_attach")
	assertEqual(t, failure["code"].(string), "pty_attach_failed")
	assertEqual(t, failure["message"].(string), "direct PTY transport does not support attaching to an existing PTY session")
}

func TestLiveTunnelSessionReportsDirectPTYTransportConnectFailure(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	transportURL := closedLocalWebSocketURL(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":           "pty.session.open",
		"requestId":      "pty_req_connect",
		"ptySessionId":   "pty_connect",
		"transportUrl":   transportURL,
		"transportToken": "transport-token",
		"launch": map[string]any{
			"session": "create",
			"command": "/bin/sh",
			"args":    []string{"-lc", "sleep 30"},
		},
	})

	failure := readControlOfType(t, gatewayConnection, "pty.session.error")
	assertEqual(t, failure["requestId"].(string), "pty_req_connect")
	assertEqual(t, failure["ptySessionId"].(string), "pty_connect")
	assertEqual(t, failure["code"].(string), "pty_attach_failed")
	if !strings.Contains(failure["message"].(string), "connect") {
		t.Fatalf("expected transport connect error, got %q", failure["message"].(string))
	}
}

func TestLiveTunnelSessionRejectsWindowForUnknownStream(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.window",
		"streamId": float64(404),
		"bytes":    float64(1),
	})

	reset := readControlOfType(t, gatewayConnection, "stream.reset")
	assertEqual(t, reset["streamId"].(float64), float64(404))
	assertEqual(t, reset["code"].(string), tunnelprotocol.StreamResetCodeInvalidStreamWindow)
	assertEqual(t, reset["message"].(string), "stream.window streamId 404 is not bound to an active tunnel stream")
}

func TestLiveTunnelSessionRejectsWindowCreditAboveConfiguredMaximum(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	root := t.TempDir()

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(10),
		"channel": map[string]any{
			"kind": "fileSearch",
			"cwd":  root,
		},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.window",
		"streamId": float64(10),
		"bytes":    float64(1),
	})

	reset := readControlOfType(t, gatewayConnection, "stream.reset")
	assertEqual(t, reset["streamId"].(float64), float64(10))
	assertEqual(t, reset["code"].(string), tunnelprotocol.StreamResetCodeInvalidStreamWindow)
	assertEqual(t, reset["message"].(string), "stream.window credit exceeds configured maximum of 16777216 bytes")
}

func TestLiveTunnelSessionPublishesOperationRecordsAfterOpenAck(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		OperationID:             "op_123",
		OperationKind:           "start",
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	open := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, open["type"].(string), "operation.open")
	assertEqual(t, open["streamId"].(float64), float64(SandboxOperationStreamID))
	assertEqual(t, open["operationId"].(string), "op_123")
	assertEqual(t, open["operationKind"].(string), "start")
	assertEqual(t, open["format"].(string), SandboxOperationStreamFormat)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, session.RecordOperationLine(ctx, "{\"kind\":\"lifecycle\"}\n"))
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":               "operation.open.ok",
		"streamId":           float64(SandboxOperationStreamID),
		"initialWindowBytes": float64(64),
	})
	frame := liveSessionReadFrame(t, gatewayConnection)
	assertEqual(t, frame.StreamID, SandboxOperationStreamID)
	assertEqual(t, frame.PayloadKind, tunnelprotocol.PayloadKindRawBytes)
	assertEqual(t, string(frame.Payload), "{\"kind\":\"lifecycle\"}\n")
}

func TestLiveTunnelSessionClosesOperationStreamAfterPendingRecordsDrain(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		OperationID:             "op_123",
		OperationKind:           "snapshot",
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	open := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, open["type"].(string), "operation.open")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	requireNoError(t, session.RecordOperationLine(ctx, "abc"))
	closeResult := make(chan error, 1)
	go func() {
		closeResult <- session.CloseOperationStream(ctx)
	}()
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":               "operation.open.ok",
		"streamId":           float64(SandboxOperationStreamID),
		"initialWindowBytes": float64(3),
	})
	frame := liveSessionReadFrame(t, gatewayConnection)
	assertEqual(t, frame.StreamID, SandboxOperationStreamID)
	assertEqual(t, string(frame.Payload), "abc")
	closeMessage := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, closeMessage["type"].(string), "operation.close")
	assertEqual(t, closeMessage["streamId"].(float64), float64(SandboxOperationStreamID))
	select {
	case err := <-closeResult:
		requireNoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for operation stream close")
	}
}

func TestActivationDiagnosticsLoggerPublishesQueuedOperationRecordsToLiveTunnel(t *testing.T) {
	t.Setenv(startupdiagnostics.TestLogDirEnv, t.TempDir())
	logger, err := startupdiagnostics.InitializeActivationDiagnosticsLogger(
		startupdiagnostics.ActivationOperation{OperationKind: mistleprotocol.ActivationOperationStart},
		"ws://127.0.0.1:3900/tunnel/sbi_123?operation_id=op_123",
	)
	requireNoError(t, err)
	requireNoError(t, logger.RecordPhaseStarted(timeutil.NewMutableClock(1730000000000), "apply_runtime_plan"))
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		OperationID:             "op_123",
		OperationKind:           "start",
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	open := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, open["type"].(string), "operation.open")
	logger.AttachOperationPublisher(session)
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":               "operation.open.ok",
		"streamId":           float64(SandboxOperationStreamID),
		"initialWindowBytes": float64(4096),
	})
	frame := liveSessionReadFrame(t, gatewayConnection)
	assertEqual(t, frame.StreamID, SandboxOperationStreamID)
	assertEqual(t, frame.PayloadKind, tunnelprotocol.PayloadKindRawBytes)
	var record map[string]any
	requireNoError(t, json.Unmarshal(frame.Payload, &record))
	assertEqual(t, record["kind"].(string), "lifecycle")
	assertEqual(t, record["phase"].(string), "runtime_plan")
	assertEqual(t, record["status"].(string), "started")
	assertEqual(t, record["source"].(string), "sandboxd")
}

func TestLiveTunnelSessionRelaysPortAccessHTTPResponse(t *testing.T) {
	upstream := startPortAccessRelayHTTPServer(t)
	_, portText, err := net.SplitHostPort(upstream.Listener.Addr().String())
	requireNoError(t, err)
	port, err := strconv.ParseUint(portText, 10, 16)
	requireNoError(t, err)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	query := "name=mistle"
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":             "ports.http.open",
		"streamId":         float64(41),
		"upstreamProtocol": "http",
		"target": map[string]any{
			"kind": "port",
			"port": float64(port),
		},
		"request": map[string]any{
			"method": "GET",
			"path":   "/relay",
			"query":  query,
			"headers": map[string]any{
				"X-Request-Id": []any{"req_123"},
			},
		},
	})

	responseStart := readControlOfType(t, gatewayConnection, "ports.http.response.start")
	assertEqual(t, responseStart["streamId"].(float64), float64(41))
	assertEqual(t, responseStart["status"].(float64), float64(201))
	headers := responseStart["headers"].(map[string]any)
	responseHeaderValues := headers["X-Upstream"].([]any)
	assertEqual(t, responseHeaderValues[0].(string), "seen")
	bodyChunk := readControlOfType(t, gatewayConnection, "ports.http.body.chunk")
	assertEqual(t, bodyChunk["streamId"].(float64), float64(41))
	assertEqual(t, bodyChunk["direction"].(string), "response")
	assertEqual(t, bodyChunk["encoding"].(string), "base64")
	assertEqual(t, bodyChunk["bytes"].(string), "cmVsYXllZA==")
	bodyEnd := readControlOfType(t, gatewayConnection, "ports.http.body.end")
	assertEqual(t, bodyEnd["streamId"].(float64), float64(41))
	assertEqual(t, bodyEnd["direction"].(string), "response")
}

func TestLiveTunnelSessionReportsPortAccessHTTPConnectFailure(t *testing.T) {
	port := reserveUnusedLocalPort(t)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":             "ports.http.open",
		"streamId":         float64(43),
		"upstreamProtocol": "http",
		"target": map[string]any{
			"kind": "port",
			"port": float64(port),
		},
		"request": map[string]any{
			"method": "GET",
			"path":   "/echo",
			"headers": map[string]any{
				"host": []any{fmt.Sprintf("127.0.0.1:%d", port)},
			},
		},
	})

	errorMessage := readControlOfType(t, gatewayConnection, "ports.stream.error")
	assertEqual(t, errorMessage["streamId"].(float64), float64(43))
	assertEqual(t, errorMessage["code"].(string), "upstream_connect_failed")
	if errorMessage["message"].(string) == "" {
		t.Fatalf("expected connect failure to include a non-empty message")
	}
}

func TestLiveTunnelSessionReportsPortAccessHTTPMidResponseFailure(t *testing.T) {
	upstream := startPortAccessTruncatedHTTPServer(t)
	_, portText, err := net.SplitHostPort(upstream.Addr().String())
	requireNoError(t, err)
	port, err := strconv.ParseUint(portText, 10, 16)
	requireNoError(t, err)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":             "ports.http.open",
		"streamId":         float64(44),
		"upstreamProtocol": "http",
		"target": map[string]any{
			"kind": "port",
			"port": float64(port),
		},
		"request": map[string]any{
			"method": "GET",
			"path":   "/close-early",
			"headers": map[string]any{
				"host": []any{fmt.Sprintf("127.0.0.1:%d", port)},
			},
		},
	})

	responseStart := readControlOfType(t, gatewayConnection, "ports.http.response.start")
	assertEqual(t, responseStart["streamId"].(float64), float64(44))
	assertEqual(t, responseStart["status"].(float64), float64(200))
	for {
		message := liveSessionReadJSON(t, gatewayConnection)
		if message["streamId"] != float64(44) {
			continue
		}
		switch message["type"] {
		case "ports.http.body.chunk":
			continue
		case "ports.stream.error":
			assertEqual(t, message["code"].(string), "upstream_io_error")
			return
		default:
			t.Fatalf("unexpected port access http message: %#v", message)
		}
	}
}

func TestLiveTunnelSessionRelaysPortAccessTCPBytes(t *testing.T) {
	upstream := startPortAccessRelayTCPServer(t)
	defer upstream.Close()
	_, portText, err := net.SplitHostPort(upstream.Addr().String())
	requireNoError(t, err)
	port, err := strconv.ParseUint(portText, 10, 16)
	requireNoError(t, err)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":             "ports.tcp.open",
		"streamId":         float64(42),
		"upstreamProtocol": "http",
		"target": map[string]any{
			"kind": "port",
			"port": float64(port),
		},
	})
	connected := readControlOfType(t, gatewayConnection, "ports.tcp.connected")
	assertEqual(t, connected["streamId"].(float64), float64(42))

	encoded, err := tunnelprotocol.EncodeStreamDataFrame(42, tunnelprotocol.PayloadKindRawBytes, []byte("ping"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))

	window, frame := readPortAccessTCPWindowAndFrame(t, gatewayConnection)
	assertEqual(t, window["streamId"].(float64), float64(42))
	assertEqual(t, window["bytes"].(float64), float64(4))
	assertEqual(t, frame.StreamID, uint32(42))
	assertEqual(t, frame.PayloadKind, tunnelprotocol.PayloadKindRawBytes)
	assertEqual(t, string(frame.Payload), "pong")
	closed := readControlOfType(t, gatewayConnection, "ports.tcp.close")
	assertEqual(t, closed["streamId"].(float64), float64(42))
	assertEqual(t, closed["direction"].(string), "response")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":      "ports.tcp.close",
		"streamId":  float64(42),
		"direction": "request",
	})
	requestClosed := readControlOfType(t, gatewayConnection, "ports.tcp.close")
	assertEqual(t, requestClosed["streamId"].(float64), float64(42))
	assertEqual(t, requestClosed["direction"].(string), "request")
}

func TestLiveTunnelSessionRejectsPortAccessTCPRequestBytesBeyondStreamWindow(t *testing.T) {
	upstream := startPortAccessIdleTCPServer(t)
	defer upstream.Close()
	_, portText, err := net.SplitHostPort(upstream.Addr().String())
	requireNoError(t, err)
	port, err := strconv.ParseUint(portText, 10, 16)
	requireNoError(t, err)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":             "ports.tcp.open",
		"streamId":         float64(59),
		"upstreamProtocol": "http",
		"target": map[string]any{
			"kind": "port",
			"port": float64(port),
		},
	})
	connected := readControlOfType(t, gatewayConnection, "ports.tcp.connected")
	assertEqual(t, connected["streamId"].(float64), float64(59))

	session.mutex.Lock()
	stream := session.streams[59]
	if stream == nil {
		session.mutex.Unlock()
		t.Fatal("expected active port access tcp stream")
	}
	stream.tcpRequestWindow = 0
	session.mutex.Unlock()

	encoded, err := tunnelprotocol.EncodeStreamDataFrame(59, tunnelprotocol.PayloadKindRawBytes, []byte("!"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))

	reset := readControlOfType(t, gatewayConnection, "stream.reset")
	assertEqual(t, reset["streamId"].(float64), float64(59))
	assertEqual(t, reset["code"].(string), "stream_window_exhausted")
	assertEqual(t, reset["message"].(string), "port access tcp request stream window is exhausted")

	session.mutex.Lock()
	_, exists := session.streams[59]
	session.mutex.Unlock()
	assertEqual(t, exists, false)
}

func TestLiveTunnelSessionRejectsGenericOpenWhenStreamIDBelongsToPortAccessTCPStream(t *testing.T) {
	upstream := startPortAccessRelayTCPServer(t)
	defer upstream.Close()
	_, portText, err := net.SplitHostPort(upstream.Addr().String())
	requireNoError(t, err)
	port, err := strconv.ParseUint(portText, 10, 16)
	requireNoError(t, err)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":             "ports.tcp.open",
		"streamId":         float64(73),
		"upstreamProtocol": "http",
		"target": map[string]any{
			"kind": "port",
			"port": float64(port),
		},
	})
	connected := readControlOfType(t, gatewayConnection, "ports.tcp.connected")
	assertEqual(t, connected["streamId"].(float64), float64(73))
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(73),
		"channel": map[string]any{
			"kind": "processes",
		},
	})
	openError := readControlOfType(t, gatewayConnection, "stream.open.error")
	assertEqual(t, openError["streamId"].(float64), float64(73))
	assertEqual(t, openError["code"].(string), "invalid_connect_request")
	assertEqual(t, openError["message"].(string), "stream.open streamId 73 already exists")

	encoded, err := tunnelprotocol.EncodeStreamDataFrame(73, tunnelprotocol.PayloadKindRawBytes, []byte("ping"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))

	window, frame := readPortAccessTCPWindowAndFrame(t, gatewayConnection)
	assertEqual(t, window["streamId"].(float64), float64(73))
	assertEqual(t, window["bytes"].(float64), float64(4))
	assertEqual(t, frame.StreamID, uint32(73))
	assertEqual(t, frame.PayloadKind, tunnelprotocol.PayloadKindRawBytes)
	assertEqual(t, string(frame.Payload), "pong")
}

func TestLiveTunnelSessionRunsExecStreamAndPublishesResult(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		RuntimeEnv:              map[string]string{"MISTLE_EXEC_TEST": "runtime-env-value"},
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(11),
		"channel": map[string]any{
			"kind":    "exec",
			"command": "/bin/sh",
			"args":    []any{"-c", "printf '%s' \"$MISTLE_EXEC_TEST\"; printf 'err' >&2"},
		},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	assertEqual(t, openOK["streamId"].(float64), float64(11))
	event := readControlOfType(t, gatewayConnection, "stream.event")
	assertEqual(t, event["streamId"].(float64), float64(11))
	execEvent := event["event"].(map[string]any)
	assertEqual(t, execEvent["type"].(string), "exec.result")
	assertEqual(t, execEvent["exitCode"].(float64), float64(0))
	assertEqual(t, execEvent["stdout"].(string), "runtime-env-value")
	assertEqual(t, execEvent["stderr"].(string), "err")
	assertEqual(t, execEvent["truncated"].(bool), false)
	complete := readControlOfType(t, gatewayConnection, "stream.complete")
	assertEqual(t, complete["streamId"].(float64), float64(11))
}

func TestLiveTunnelSessionUsesUpdatedRuntimeEnvironmentForLaterExecStreams(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		RuntimeEnv:              map[string]string{"MISTLE_EXEC_TEST": "before-update"},
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	session.SetRuntimeEnv(map[string]string{"MISTLE_EXEC_TEST": "after-update"})
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(12),
		"channel": map[string]any{
			"kind":    "exec",
			"command": "/bin/sh",
			"args":    []any{"-c", "printf '%s' \"$MISTLE_EXEC_TEST\""},
		},
	})
	openOK := readControlOfType(t, gatewayConnection, "stream.open.ok")
	assertEqual(t, openOK["streamId"].(float64), float64(12))
	event := readControlOfType(t, gatewayConnection, "stream.event")
	assertEqual(t, event["streamId"].(float64), float64(12))
	execEvent := event["event"].(map[string]any)
	assertEqual(t, execEvent["type"].(string), "exec.result")
	assertEqual(t, execEvent["exitCode"].(float64), float64(0))
	assertEqual(t, execEvent["stdout"].(string), "after-update")
	complete := readControlOfType(t, gatewayConnection, "stream.complete")
	assertEqual(t, complete["streamId"].(float64), float64(12))
}

func TestLiveTunnelSessionResetsExecStreamWhenCommandFailsBeforeResult(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(12),
		"channel": map[string]any{
			"kind":      "exec",
			"command":   "/bin/sh",
			"args":      []any{"-c", "sleep 1"},
			"timeoutMs": float64(1),
		},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	reset := readControlOfType(t, gatewayConnection, "stream.reset")
	assertEqual(t, reset["streamId"].(float64), float64(12))
	assertEqual(t, reset["code"].(string), tunnelprotocol.StreamResetCodeExecCommandFailed)
	if !strings.Contains(reset["message"].(string), "command timed out after 1ms") {
		t.Fatalf("expected timeout reset message, got %q", reset["message"].(string))
	}
}

func TestLiveTunnelSessionCancelsExecStreamOnClose(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	outputPath := filepath.Join(t.TempDir(), "exec-finished")

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(13),
		"channel": map[string]any{
			"kind":    "exec",
			"command": "/bin/sh",
			"args":    []any{"-c", "sleep 1; printf done > " + outputPath},
		},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.close",
		"streamId": float64(13),
	})
	time.Sleep(1500 * time.Millisecond)
	if _, err := os.Stat(outputPath); !os.IsNotExist(err) {
		t.Fatalf("expected closed exec stream to cancel command before writing %s, stat err=%v", outputPath, err)
	}
}

func TestLiveTunnelSessionCompletesFileUploadStream(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	attachmentRoot := t.TempDir()
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AttachmentRoot:          attachmentRoot,
		Clock:                   timeutil.NewMutableClock(123456),
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(31),
		"channel": map[string]any{
			"kind":             "fileUpload",
			"threadId":         "thread_123",
			"mimeType":         "text/plain",
			"originalFilename": "notes.TXT",
			"sizeBytes":        float64(11),
		},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	assertEqual(t, openOK["streamId"].(float64), float64(31))

	encoded, err := tunnelprotocol.EncodeStreamDataFrame(31, tunnelprotocol.PayloadKindRawBytes, []byte("hello world"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))
	window := readControlOfType(t, gatewayConnection, "stream.window")
	assertEqual(t, window["streamId"].(float64), float64(31))
	assertEqual(t, window["bytes"].(float64), float64(11))

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.close",
		"streamId": float64(31),
	})
	event := readControlOfType(t, gatewayConnection, "stream.event")
	assertEqual(t, event["streamId"].(float64), float64(31))
	uploadEvent := event["event"].(map[string]any)
	assertEqual(t, uploadEvent["type"].(string), "fileUpload.completed")
	assertEqual(t, uploadEvent["kind"].(string), UploadedFileKindFile)
	assertEqual(t, uploadEvent["attachmentId"].(string), "att_123456_1")
	assertEqual(t, uploadEvent["threadId"].(string), "thread_123")
	assertEqual(t, uploadEvent["originalFilename"].(string), "notes.TXT")
	assertEqual(t, uploadEvent["mimeType"].(string), "text/plain")
	assertEqual(t, uploadEvent["sizeBytes"].(float64), float64(11))
	path := uploadEvent["path"].(string)
	assertEqual(t, path, filepath.Join(attachmentRoot, "thread_123", "att_123456_1.txt"))
	contents, err := os.ReadFile(path)
	requireNoError(t, err)
	assertEqual(t, string(contents), "hello world")
	complete := readControlOfType(t, gatewayConnection, "stream.complete")
	assertEqual(t, complete["streamId"].(float64), float64(31))
}

func TestLiveTunnelSessionCompletesImageFileUploadStream(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	attachmentRoot := t.TempDir()
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AttachmentRoot:          attachmentRoot,
		Clock:                   timeutil.NewMutableClock(223344),
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(35),
		"channel": map[string]any{
			"kind":             "fileUpload",
			"threadId":         "thread_image",
			"mimeType":         "image/png",
			"originalFilename": "image.png",
			"sizeBytes":        float64(8),
		},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	assertEqual(t, openOK["streamId"].(float64), float64(35))

	pngBytes := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}
	encoded, err := tunnelprotocol.EncodeStreamDataFrame(35, tunnelprotocol.PayloadKindRawBytes, pngBytes)
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))
	window := readControlOfType(t, gatewayConnection, "stream.window")
	assertEqual(t, window["streamId"].(float64), float64(35))
	assertEqual(t, window["bytes"].(float64), float64(len(pngBytes)))

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.close",
		"streamId": float64(35),
	})
	event := readControlOfType(t, gatewayConnection, "stream.event")
	uploadEvent := event["event"].(map[string]any)
	assertEqual(t, uploadEvent["type"].(string), "fileUpload.completed")
	assertEqual(t, uploadEvent["kind"].(string), UploadedFileKindImage)
	assertEqual(t, uploadEvent["threadId"].(string), "thread_image")
	assertEqual(t, uploadEvent["originalFilename"].(string), "image.png")
	assertEqual(t, uploadEvent["mimeType"].(string), "image/png")
	assertEqual(t, uploadEvent["sizeBytes"].(float64), float64(len(pngBytes)))
	path := uploadEvent["path"].(string)
	assertEqual(t, filepath.Ext(path), ".png")
	assertEqual(t, filepath.Dir(path), filepath.Join(attachmentRoot, "thread_image"))
	contents, err := os.ReadFile(path)
	requireNoError(t, err)
	assertEqual(t, string(contents), string(pngBytes))
	complete := readControlOfType(t, gatewayConnection, "stream.complete")
	assertEqual(t, complete["streamId"].(float64), float64(35))
}

func TestLiveTunnelSessionRejectsInvalidImageFileUploadAndRemovesPartialFile(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	attachmentRoot := t.TempDir()
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AttachmentRoot:          attachmentRoot,
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(36),
		"channel": map[string]any{
			"kind":             "fileUpload",
			"threadId":         "thread_invalid_image",
			"mimeType":         "image/png",
			"originalFilename": "image.png",
			"sizeBytes":        float64(8),
		},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	tempPath := requireOnlyUploadPartPath(t, filepath.Join(attachmentRoot, "thread_invalid_image"))

	encoded, err := tunnelprotocol.EncodeStreamDataFrame(36, tunnelprotocol.PayloadKindRawBytes, []byte("notimage"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))
	window := readControlOfType(t, gatewayConnection, "stream.window")
	assertEqual(t, window["streamId"].(float64), float64(36))
	assertEqual(t, window["bytes"].(float64), float64(8))

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.close",
		"streamId": float64(36),
	})
	reset := readControlOfType(t, gatewayConnection, "stream.reset")
	assertEqual(t, reset["streamId"].(float64), float64(36))
	assertEqual(t, reset["code"].(string), tunnelprotocol.FileUploadResetCodeInvalidFileType)
	assertEqual(t, reset["message"].(string), "uploaded file is not a supported image")
	assertPathMissing(t, tempPath)
	assertUploadDirectoryContainsOnlyTransientFiles(t, filepath.Join(attachmentRoot, "thread_invalid_image"))
}

func TestLiveTunnelSessionRejectsInvalidFileUploadMetadata(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AttachmentRoot:          t.TempDir(),
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(32),
		"channel": map[string]any{
			"kind":             "fileUpload",
			"threadId":         "../thread",
			"mimeType":         "text/plain",
			"originalFilename": "notes.txt",
			"sizeBytes":        float64(1),
		},
	})
	openError := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openError["type"].(string), "stream.open.error")
	assertEqual(t, openError["streamId"].(float64), float64(32))
	assertEqual(t, openError["code"].(string), tunnelprotocol.ConnectErrorCodeInvalidConnectRequest)
	assertEqual(t, openError["message"].(string), "threadId must use only ASCII letters, digits, '_' or '-'.")
}

func TestLiveTunnelSessionResetsFileUploadWhenBytesExceedDeclaration(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	attachmentRoot := t.TempDir()
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AttachmentRoot:          attachmentRoot,
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(33),
		"channel": map[string]any{
			"kind":             "fileUpload",
			"threadId":         "thread_123",
			"mimeType":         "text/plain",
			"originalFilename": "notes.txt",
			"sizeBytes":        float64(3),
		},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	tempPath := requireOnlyUploadPartPath(t, filepath.Join(attachmentRoot, "thread_123"))

	encoded, err := tunnelprotocol.EncodeStreamDataFrame(33, tunnelprotocol.PayloadKindRawBytes, []byte("too many"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))

	reset := readControlOfType(t, gatewayConnection, "stream.reset")
	assertEqual(t, reset["streamId"].(float64), float64(33))
	assertEqual(t, reset["code"].(string), tunnelprotocol.FileUploadResetCodeByteCountExceeded)
	assertEqual(t, reset["message"].(string), "received more bytes than declared by the upload metadata")
	assertPathMissing(t, tempPath)
}

func TestLiveTunnelSessionResetsFileUploadAndRemovesPartialFileAfterInvalidPayloadKind(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	attachmentRoot := t.TempDir()
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AttachmentRoot:          attachmentRoot,
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(34),
		"channel": map[string]any{
			"kind":             "fileUpload",
			"threadId":         "thread_123",
			"mimeType":         "text/plain",
			"originalFilename": "notes.txt",
			"sizeBytes":        float64(3),
		},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	tempPath := requireOnlyUploadPartPath(t, filepath.Join(attachmentRoot, "thread_123"))

	encoded, err := tunnelprotocol.EncodeStreamDataFrame(34, tunnelprotocol.PayloadKindWebSocketBinary, []byte("bad"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))

	reset := readControlOfType(t, gatewayConnection, "stream.reset")
	assertEqual(t, reset["streamId"].(float64), float64(34))
	assertEqual(t, reset["code"].(string), tunnelprotocol.StreamResetCodeInvalidStreamData)
	assertEqual(t, reset["message"].(string), "file upload stream only accepts raw byte payloads")
	assertPathMissing(t, tempPath)
}

func TestLiveTunnelSessionSearchesFilesOnFileSearchStream(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	root := t.TempDir()
	requireNoError(t, os.Mkdir(filepath.Join(root, "src"), 0o755))
	requireNoError(t, os.WriteFile(filepath.Join(root, "src", "protocol.go"), []byte("package src\n"), 0o644))
	requireNoError(t, os.WriteFile(filepath.Join(root, "README.md"), []byte("docs\n"), 0o644))

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(21),
		"channel": map[string]any{
			"kind": "fileSearch",
			"cwd":  root,
		},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")
	assertEqual(t, openOK["streamId"].(float64), float64(21))

	queryPayload := `{"type":"fileSearch.query","requestId":"file_req_1","query":"protocol","limit":10}`
	encoded, err := tunnelprotocol.EncodeStreamDataFrame(21, tunnelprotocol.PayloadKindWebSocketText, []byte(queryPayload))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))

	window := readControlOfType(t, gatewayConnection, "stream.window")
	assertEqual(t, window["streamId"].(float64), float64(21))
	assertEqual(t, window["bytes"].(float64), float64(len(queryPayload)))
	frame := liveSessionReadFrame(t, gatewayConnection)
	assertEqual(t, frame.StreamID, uint32(21))
	assertEqual(t, frame.PayloadKind, tunnelprotocol.PayloadKindWebSocketText)
	var results map[string]any
	requireNoError(t, json.Unmarshal(frame.Payload, &results))
	assertEqual(t, results["type"].(string), "fileSearch.results")
	assertEqual(t, results["requestId"].(string), "file_req_1")
	assertEqual(t, results["query"].(string), "protocol")
	items := results["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected one file search result, got %d", len(items))
	}
	item := items[0].(map[string]any)
	assertEqual(t, item["path"].(string), "src/protocol.go")
	assertEqual(t, item["kind"].(string), "file")
}

func TestLiveTunnelSessionRejectsGatewayFileSearchResultsPayload(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)
	root := t.TempDir()

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(22),
		"channel": map[string]any{
			"kind": "fileSearch",
			"cwd":  root,
		},
	})
	openOK := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openOK["type"].(string), "stream.open.ok")

	payload := `{"type":"fileSearch.results","requestId":"file_req_1","query":"protocol","items":[]}`
	encoded, err := tunnelprotocol.EncodeStreamDataFrame(22, tunnelprotocol.PayloadKindWebSocketText, []byte(payload))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, encoded))

	reset := readControlOfType(t, gatewayConnection, "stream.reset")
	assertEqual(t, reset["streamId"].(float64), float64(22))
	assertEqual(t, reset["code"].(string), tunnelprotocol.StreamResetCodeInvalidStreamData)
	if !strings.Contains(reset["message"].(string), "does not accept fileSearch.results") {
		t.Fatalf("expected rejected fileSearch.results message, got %q", reset["message"].(string))
	}
}

func TestLiveTunnelSessionRejectsFileSearchOpenWithoutCWD(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(23),
		"channel":  map[string]any{"kind": "fileSearch"},
	})
	openError := liveSessionReadJSON(t, gatewayConnection)
	assertEqual(t, openError["type"].(string), "stream.open.error")
	assertEqual(t, openError["streamId"].(float64), float64(23))
	assertEqual(t, openError["code"].(string), tunnelprotocol.ConnectErrorCodeFileSearchUnavailable)
	assertEqual(t, openError["message"].(string), "file search cwd is required")
}

func TestLiveTunnelSessionResetsAndReleasesAgentStreamAfterInvalidPayloadKind(t *testing.T) {
	agentServer := startLiveSessionIdleAgentServer(t)
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		AgentEndpointURL:        liveSessionWebSocketURL(agentServer),
		Clock:                   timeutil.SystemClock{},
		KeepaliveManager:        keepalive.NewSharedManager(),
		RuntimeReadinessManager: &readiness.Manager{},
	})
	requireNoError(t, err)
	defer session.Close()
	requireInitialRuntimeReady(t, gatewayConnection, false)

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(7),
		"channel":  map[string]any{"kind": "agent"},
	})
	firstOpenOK := readControlOfType(t, gatewayConnection, "stream.open.ok")
	assertEqual(t, firstOpenOK["streamId"].(float64), float64(7))
	invalidFrame, err := tunnelprotocol.EncodeStreamDataFrame(7, tunnelprotocol.PayloadKindRawBytes, []byte("not websocket payload"))
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	requireNoError(t, gatewayConnection.Write(ctx, websocket.MessageBinary, invalidFrame))
	reset := readControlOfType(t, gatewayConnection, "stream.reset")
	assertEqual(t, reset["streamId"].(float64), float64(7))
	assertEqual(t, reset["code"].(string), tunnelprotocol.StreamResetCodeInvalidStreamData)
	assertEqual(t, reset["message"].(string), "agent stream only accepts websocket text or binary payload kinds")

	liveSessionWriteJSON(t, gatewayConnection, map[string]any{
		"type":     "stream.open",
		"streamId": float64(7),
		"channel":  map[string]any{"kind": "agent"},
	})
	secondOpenOK := readControlOfType(t, gatewayConnection, "stream.open.ok")
	assertEqual(t, secondOpenOK["streamId"].(float64), float64(7))
}

func TestLiveTunnelSessionPublishesReadinessAndKeepaliveStates(t *testing.T) {
	gatewayServer, gatewayConnections := startLiveSessionGatewayServer(t)
	tunnel, err := ConnectBootstrapTunnel(context.Background(), liveSessionWebSocketURL(gatewayServer), "bootstrap-token")
	requireNoError(t, err)
	gatewayConnection := <-gatewayConnections
	clock := timeutil.NewMutableClock(100)
	keepaliveManager := keepalive.NewSharedManager()
	runtimeReadinessManager := &readiness.Manager{}
	session, err := StartLiveTunnelSession(tunnel, LiveTunnelSessionOptions{
		Clock:                   clock,
		KeepaliveManager:        keepaliveManager,
		RuntimeReadinessManager: runtimeReadinessManager,
	})
	requireNoError(t, err)
	defer session.Close()

	requireInitialRuntimeReady(t, gatewayConnection, false)
	firstKeepalive := readControlOfType(t, gatewayConnection, "keepalive.state")
	assertEqual(t, firstKeepalive["ttlMs"].(float64), float64(30000))
	assertEqual(t, firstKeepalive["active"].(bool), false)

	runtimeReadinessManager.SetReady(true)
	nextReady := readControlOfType(t, gatewayConnection, "runtime.ready")
	assertEqual(t, nextReady["ready"].(bool), true)

	keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
		manager.SetPlatformActive(true)
	})
	nextKeepalive := readControlOfType(t, gatewayConnection, "keepalive.state")
	assertEqual(t, nextKeepalive["active"].(bool), true)
}

func startLiveSessionAgentServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected agent websocket accept: %v", err)
			return
		}
		defer connection.CloseNow()
		ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
		defer cancel()
		messageType, payload, err := connection.Read(ctx)
		if err != nil {
			t.Errorf("expected agent websocket payload: %v", err)
			return
		}
		assertEqual(t, messageType, websocket.MessageText)
		assertEqual(t, string(payload), "hello-agent")
		requireNoError(t, connection.Write(ctx, websocket.MessageText, []byte("hello-gateway")))
		<-request.Context().Done()
	}))
	t.Cleanup(server.Close)
	return server
}

func startLiveSessionIdleAgentServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected idle agent websocket accept: %v", err)
			return
		}
		defer connection.CloseNow()
		<-request.Context().Done()
	}))
	t.Cleanup(server.Close)
	return server
}

func startLiveSessionTriggeredAgentServer(t *testing.T, payload []byte) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected agent websocket accept: %v", err)
			return
		}
		defer connection.CloseNow()
		ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
		defer cancel()
		_, _, err = connection.Read(ctx)
		requireNoError(t, err)
		requireNoError(t, connection.Write(ctx, websocket.MessageBinary, payload))
		<-request.Context().Done()
	}))
	t.Cleanup(server.Close)
	return server
}

func startPortAccessRelayHTTPServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.Method, http.MethodGet)
		assertEqual(t, request.URL.Path, "/relay")
		assertEqual(t, request.URL.RawQuery, "name=mistle")
		assertEqual(t, request.Header.Get("X-Request-Id"), "req_123")
		responseWriter.Header().Set("X-Upstream", "seen")
		responseWriter.WriteHeader(http.StatusCreated)
		_, err := responseWriter.Write([]byte("relayed"))
		requireNoError(t, err)
	}))
	t.Cleanup(server.Close)
	return server
}

func reserveUnusedLocalPort(t *testing.T) uint64 {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	_, portText, err := net.SplitHostPort(listener.Addr().String())
	requireNoError(t, err)
	port, err := strconv.ParseUint(portText, 10, 16)
	requireNoError(t, err)
	requireNoError(t, listener.Close())
	return port
}

func startPortAccessTruncatedHTTPServer(t *testing.T) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	done := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			done <- err
			return
		}
		defer connection.Close()
		buffer := make([]byte, 1024)
		if _, err := connection.Read(buffer); err != nil {
			done <- err
			return
		}
		_, err = connection.Write([]byte("HTTP/1.1 200 OK\r\nContent-Length: 1024\r\n\r\npartial"))
		done <- err
	}()
	t.Cleanup(func() {
		_ = listener.Close()
		select {
		case err := <-done:
			requireNoError(t, err)
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for truncated http server")
		}
	})
	return listener
}

func startPortAccessRelayTCPServer(t *testing.T) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	done := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			done <- err
			return
		}
		defer connection.Close()
		buffer := make([]byte, 4)
		if _, err := connection.Read(buffer); err != nil {
			done <- err
			return
		}
		if string(buffer) != "ping" {
			done <- errUnexpectedTCPPayload(string(buffer))
			return
		}
		if _, err := connection.Write([]byte("pong")); err != nil {
			done <- err
			return
		}
		done <- nil
	}()
	t.Cleanup(func() {
		_ = listener.Close()
		select {
		case err := <-done:
			requireNoError(t, err)
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for tcp relay server")
		}
	})
	return listener
}

func startPortAccessIdleTCPServer(t *testing.T) net.Listener {
	t.Helper()
	listener, done := startPortAccessObservedIdleTCPServer(t)
	t.Cleanup(func() {
		_ = listener.Close()
		select {
		case err := <-done:
			requireNoError(t, err)
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for idle tcp server")
		}
	})
	return listener
}

func startPortAccessObservedIdleTCPServer(t *testing.T) (net.Listener, <-chan error) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	done := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			done <- err
			return
		}
		defer connection.Close()
		buffer := make([]byte, 1)
		bytesRead, err := connection.Read(buffer)
		if errors.Is(err, io.EOF) {
			done <- nil
			return
		}
		if err != nil {
			done <- err
			return
		}
		done <- errUnexpectedTCPPayload(string(buffer[:bytesRead]))
	}()
	return listener, done
}

type errUnexpectedTCPPayload string

func (err errUnexpectedTCPPayload) Error() string {
	return "unexpected tcp payload " + string(err)
}

func startLiveSessionGatewayServer(t *testing.T) (*httptest.Server, <-chan *websocket.Conn) {
	t.Helper()
	connections := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected gateway websocket accept: %v", err)
			return
		}
		connection.SetReadLimit(tunnelWebSocketReadLimitBytes)
		connections <- connection
		<-request.Context().Done()
	}))
	t.Cleanup(server.Close)
	return server, connections
}

func startPTYTransportServer(t *testing.T) (*httptest.Server, <-chan *websocket.Conn) {
	t.Helper()
	connections := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			t.Errorf("expected pty transport websocket accept: %v", err)
			return
		}
		connections <- connection
		<-request.Context().Done()
	}))
	t.Cleanup(server.Close)
	return server, connections
}

func liveSessionWebSocketURL(server *httptest.Server) string {
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sbi_123"
}

func closedLocalWebSocketURL(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	address := listener.Addr().String()
	requireNoError(t, listener.Close())
	return "ws://" + address + "/pty"
}

func liveSessionWriteJSON(t *testing.T, connection *websocket.Conn, payload map[string]any) {
	t.Helper()
	serialized, err := json.Marshal(payload)
	requireNoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	requireNoError(t, connection.Write(ctx, websocket.MessageText, serialized))
}

func liveSessionReadJSON(t *testing.T, connection *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	messageType, payload, err := connection.Read(ctx)
	requireNoError(t, err)
	assertEqual(t, messageType, websocket.MessageText)
	var decoded map[string]any
	requireNoError(t, json.Unmarshal(payload, &decoded))
	return decoded
}

func requireRuntimeReadyAndTelemetryOpenOnServer(t *testing.T, connection *websocket.Conn, expectedReady bool) {
	t.Helper()
	runtimeReady := liveSessionReadJSON(t, connection)
	assertEqual(t, runtimeReady["type"].(string), "runtime.ready")
	assertEqual(t, runtimeReady["ready"].(bool), expectedReady)
	telemetryOpen := liveSessionReadJSON(t, connection)
	assertEqual(t, telemetryOpen["type"].(string), "telemetry.open")
	assertEqual(t, telemetryOpen["streamId"].(float64), float64(SandboxTelemetryLogStreamID))
}

func receiveString(t *testing.T, values <-chan string) string {
	t.Helper()
	select {
	case value := <-values:
		return value
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for string value")
		return ""
	}
}

func receiveTelemetryRecord(t *testing.T, records <-chan map[string]any) map[string]any {
	t.Helper()
	select {
	case record := <-records:
		return record
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for telemetry record")
		return nil
	}
}

func requireOnlyUploadPartPath(t *testing.T, directory string) string {
	t.Helper()
	entries, err := os.ReadDir(directory)
	requireNoError(t, err)
	var partPaths []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, ".") && strings.HasSuffix(name, ".part") {
			partPaths = append(partPaths, filepath.Join(directory, name))
		}
	}
	if len(partPaths) != 1 {
		t.Fatalf("expected exactly one upload part file in %s, got %v", directory, partPaths)
	}
	return partPaths[0]
}

func assertPathMissing(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected %s to be removed, stat err=%v", path, err)
	}
}

func assertUploadDirectoryContainsOnlyTransientFiles(t *testing.T, directory string) {
	t.Helper()
	entries, err := os.ReadDir(directory)
	if os.IsNotExist(err) {
		return
	}
	requireNoError(t, err)
	for _, entry := range entries {
		if entry.IsDir() {
			t.Fatalf("expected rejected upload directory %s not to contain finalized directory %s", directory, entry.Name())
		}
		name := entry.Name()
		if !strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".part") {
			t.Fatalf("expected rejected upload directory %s not to contain finalized attachment %s", directory, name)
		}
	}
}

func useTestReconnectBackoff(backoff []time.Duration) func() {
	previous := DefaultTunnelReconnectBackoff
	DefaultTunnelReconnectBackoff = append([]time.Duration(nil), backoff...)
	return func() {
		DefaultTunnelReconnectBackoff = previous
	}
}

func readPTYTransportBinaryContaining(t *testing.T, connection *websocket.Conn, expected string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var output strings.Builder
	for !strings.Contains(output.String(), expected) {
		messageType, payload, err := connection.Read(ctx)
		requireNoError(t, err)
		if messageType == websocket.MessageBinary {
			output.Write(payload)
		}
	}
	return output.String()
}

func readPTYTransportEvent(t *testing.T, connection *websocket.Conn, eventType string) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for {
		messageType, payload, err := connection.Read(ctx)
		requireNoError(t, err)
		if messageType != websocket.MessageText {
			continue
		}
		var decoded map[string]any
		requireNoError(t, json.Unmarshal(payload, &decoded))
		event, _ := decoded["event"].(map[string]any)
		if event["type"] == eventType {
			return decoded
		}
	}
}

func liveSessionReadFrame(t *testing.T, connection *websocket.Conn) tunnelprotocol.StreamDataFrame {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	messageType, payload, err := connection.Read(ctx)
	requireNoError(t, err)
	assertEqual(t, messageType, websocket.MessageBinary)
	frame, err := tunnelprotocol.DecodeStreamDataFrame(payload)
	requireNoError(t, err)
	return frame
}

func readPortAccessTCPWindowAndFrame(t *testing.T, connection *websocket.Conn) (map[string]any, tunnelprotocol.StreamDataFrame) {
	t.Helper()
	var window map[string]any
	var frame *tunnelprotocol.StreamDataFrame
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for window == nil || frame == nil {
		messageType, payload, err := connection.Read(ctx)
		requireNoError(t, err)
		switch messageType {
		case websocket.MessageText:
			var decoded map[string]any
			requireNoError(t, json.Unmarshal(payload, &decoded))
			if decoded["type"] == "stream.window" {
				window = decoded
			}
		case websocket.MessageBinary:
			decodedFrame, err := tunnelprotocol.DecodeStreamDataFrame(payload)
			requireNoError(t, err)
			frame = &decodedFrame
		default:
			t.Fatalf("unexpected websocket message type %v", messageType)
		}
	}
	return window, *frame
}

func readTelemetryRecordOfEvent(t *testing.T, connection *websocket.Conn, event string) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for {
		messageType, payload, err := connection.Read(ctx)
		requireNoError(t, err)
		switch messageType {
		case websocket.MessageText:
			continue
		case websocket.MessageBinary:
			frame, err := tunnelprotocol.DecodeStreamDataFrame(payload)
			requireNoError(t, err)
			if frame.StreamID != SandboxTelemetryLogStreamID {
				continue
			}
			assertEqual(t, frame.PayloadKind, tunnelprotocol.PayloadKindRawBytes)
			var record map[string]any
			requireNoError(t, json.Unmarshal(frame.Payload, &record))
			if record["event"] == event {
				return record
			}
		default:
			t.Fatalf("unexpected websocket message type %v", messageType)
		}
	}
}

func readControlAndTelemetryEvent(t *testing.T, connection *websocket.Conn, controlType string, event string) (map[string]any, map[string]any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var control map[string]any
	var telemetry map[string]any
	for control == nil || telemetry == nil {
		messageType, payload, err := connection.Read(ctx)
		requireNoError(t, err)
		switch messageType {
		case websocket.MessageText:
			var decoded map[string]any
			requireNoError(t, json.Unmarshal(payload, &decoded))
			if decoded["type"] == controlType {
				control = decoded
			}
		case websocket.MessageBinary:
			frame, err := tunnelprotocol.DecodeStreamDataFrame(payload)
			requireNoError(t, err)
			if frame.StreamID != SandboxTelemetryLogStreamID {
				continue
			}
			assertEqual(t, frame.PayloadKind, tunnelprotocol.PayloadKindRawBytes)
			var decoded map[string]any
			requireNoError(t, json.Unmarshal(frame.Payload, &decoded))
			if decoded["event"] == event {
				telemetry = decoded
			}
		default:
			t.Fatalf("unexpected websocket message type %v", messageType)
		}
	}
	return control, telemetry
}

func requireInitialRuntimeReady(t *testing.T, connection *websocket.Conn, expectedReady bool) {
	t.Helper()
	message := liveSessionReadJSON(t, connection)
	assertEqual(t, message["type"].(string), "runtime.ready")
	assertEqual(t, message["ready"].(bool), expectedReady)
	telemetryOpen := liveSessionReadJSON(t, connection)
	assertEqual(t, telemetryOpen["type"].(string), "telemetry.open")
	assertEqual(t, telemetryOpen["streamId"].(float64), float64(SandboxTelemetryLogStreamID))
	assertEqual(t, telemetryOpen["signal"].(string), telemetryLogsSignal)
	assertEqual(t, telemetryOpen["format"].(string), telemetryLogsFormat)
}

func readControlOfType(t *testing.T, connection *websocket.Conn, messageType string) map[string]any {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for %s control message", messageType)
		default:
		}
		message := liveSessionReadJSON(t, connection)
		if message["type"] == messageType {
			return message
		}
	}
}
