package tunnel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

func writeTestTunnelTokenExchangeResponse(
	t *testing.T,
	writer http.ResponseWriter,
	bootstrapToken string,
	tunnelExchangeToken string,
) {
	t.Helper()

	writer.Header().Set("content-type", "application/json")
	if err := json.NewEncoder(writer).Encode(tunnelTokenExchangeResponse{
		BootstrapToken:      bootstrapToken,
		TunnelExchangeToken: tunnelExchangeToken,
	}); err != nil {
		t.Fatalf("expected tunnel token exchange response encode to succeed, got %v", err)
	}
}

func TestRun(t *testing.T) {
	t.Run("fails when context is missing", func(t *testing.T) {
		err := Run(RunInput{
			GatewayWSURL:        "ws://127.0.0.1:8090/tunnel/sandbox",
			BootstrapToken:      []byte("token"),
			TunnelExchangeToken: testLongLivedTunnelExchangeToken(t),
		})
		if err == nil {
			t.Fatal("expected error when context is missing")
		}
	})

	t.Run("fails when bootstrap token is empty", func(t *testing.T) {
		err := Run(RunInput{
			Context:             context.Background(),
			GatewayWSURL:        "ws://127.0.0.1:8090/tunnel/sandbox",
			BootstrapToken:      []byte(" \n\t "),
			TunnelExchangeToken: testLongLivedTunnelExchangeToken(t),
		})
		if err == nil {
			t.Fatal("expected error when bootstrap token is empty")
		}
	})

	t.Run("fails when gateway ws url uses unsupported scheme", func(t *testing.T) {
		err := Run(RunInput{
			Context:             context.Background(),
			GatewayWSURL:        "http://127.0.0.1:8090/tunnel/sandbox",
			BootstrapToken:      []byte("token"),
			TunnelExchangeToken: testLongLivedTunnelExchangeToken(t),
		})
		if err == nil {
			t.Fatal("expected error when gateway ws url scheme is unsupported")
		}
	})

	t.Run("reconnects with an exchanged bootstrap token after the websocket closes", func(t *testing.T) {
		tokenQueryValues := make(chan string, 2)
		requestPathValues := make(chan string, 2)
		handlerErrCh := make(chan error, 1)
		runCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		connectionCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			switch request.URL.Path {
			case "/tunnel/sandbox/sbi_tunnel_test_001":
				tokenQueryValues <- request.URL.Query().Get(bootstrapTokenQueryParam)
				requestPathValues <- request.URL.Path
				connectionCount++

				conn, err := websocket.Accept(writer, request, nil)
				if err != nil {
					select {
					case handlerErrCh <- fmt.Errorf("expected websocket accept to succeed, got %w", err):
					default:
					}
					return
				}
				defer conn.CloseNow()

				if connectionCount == 2 {
					cancel()
				}

				_ = conn.Close(websocket.StatusNormalClosure, "test completed")
			case "/tunnel/sandbox/sbi_tunnel_test_001/token-exchange":
				writeTestTunnelTokenExchangeResponse(
					t,
					writer,
					"rotated-bootstrap-token-001",
					testLongLivedTunnelExchangeToken(t),
				)
			default:
				select {
				case handlerErrCh <- fmt.Errorf("unexpected request path %q", request.URL.Path):
				default:
				}
			}
		}))
		defer server.Close()

		gatewayWSURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sandbox/sbi_tunnel_test_001"

		err := Run(RunInput{
			Context:             runCtx,
			GatewayWSURL:        gatewayWSURL,
			BootstrapToken:      []byte("sandbox-bootstrap-token"),
			TunnelExchangeToken: testLongLivedTunnelExchangeToken(t),
		})
		if err != nil {
			t.Fatalf("expected run to stop cleanly after reconnect and context cancel, got %v", err)
		}

		select {
		case firstQueryToken := <-tokenQueryValues:
			if firstQueryToken != "sandbox-bootstrap-token" {
				t.Fatalf("expected first bootstrap token query to match, got %s", firstQueryToken)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("expected first token query to be recorded")
		}

		select {
		case secondQueryToken := <-tokenQueryValues:
			if secondQueryToken != "rotated-bootstrap-token-001" {
				t.Fatalf("expected second bootstrap token query to match rotated token, got %s", secondQueryToken)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("expected second token query to be recorded")
		}

		for range 2 {
			select {
			case requestPath := <-requestPathValues:
				if requestPath != "/tunnel/sandbox/sbi_tunnel_test_001" {
					t.Fatalf("expected request path to match, got %s", requestPath)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("expected request path to be recorded")
			}
		}

		select {
		case handlerErr := <-handlerErrCh:
			t.Fatal(handlerErr)
		default:
		}
	})

	t.Run("connects to agent endpoint and relays websocket frames", func(t *testing.T) {
		agentRequestCh := make(chan string, 1)
		gatewayResponseCh := make(chan string, 1)
		handlerErrCh := make(chan error, 1)
		runCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		agentServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			conn, err := websocket.Accept(writer, request, nil)
			if err != nil {
				handlerErrCh <- fmt.Errorf("expected agent websocket accept to succeed: %w", err)
				return
			}
			defer conn.CloseNow()

			handlerCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			messageType, payload, err := conn.Read(handlerCtx)
			if err != nil {
				handlerErrCh <- fmt.Errorf("expected agent websocket read to succeed: %w", err)
				return
			}
			if messageType != websocket.MessageText {
				handlerErrCh <- fmt.Errorf("expected agent websocket text message, got %s", messageType.String())
				return
			}

			agentRequestCh <- string(payload)

			if err := conn.Write(
				handlerCtx,
				websocket.MessageText,
				[]byte(`{"jsonrpc":"2.0","id":"res-1","result":{"ok":true}}`),
			); err != nil {
				handlerErrCh <- fmt.Errorf("expected agent websocket write to succeed: %w", err)
			}
		}))
		defer agentServer.Close()

		gatewayConnectionCount := 0
		gatewayServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			switch request.URL.Path {
			case "/tunnel/sandbox/sbi_tunnel_test_002":
				gatewayConnectionCount++
				conn, err := websocket.Accept(writer, request, nil)
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected gateway websocket accept to succeed: %w", err)
					return
				}
				defer conn.CloseNow()

				if gatewayConnectionCount == 2 {
					cancel()
					_ = conn.Close(websocket.StatusNormalClosure, "reconnect observed")
					return
				}

				handlerCtx, handlerCancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer handlerCancel()

				connectRequestPayload, err := json.Marshal(sessionprotocol.AgentConnectRequest{
					Type:      sessionprotocol.MessageTypeConnect,
					V:         sessionprotocol.ProtocolVersion,
					RequestID: "req_connect_agent",
					Channel: sessionprotocol.AgentConnectChannel{
						Kind: sessionprotocol.ChannelKindAgent,
					},
				})
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected connect request payload marshal to succeed: %w", err)
					return
				}

				if err := conn.Write(handlerCtx, websocket.MessageText, connectRequestPayload); err != nil {
					handlerErrCh <- fmt.Errorf("expected connect request write to succeed: %w", err)
					return
				}

				ackType, ackPayload, err := conn.Read(handlerCtx)
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected connect ack read to succeed: %w", err)
					return
				}
				if ackType != websocket.MessageText {
					handlerErrCh <- fmt.Errorf("expected connect ack to be text, got %s", ackType.String())
					return
				}

				var connectOK sessionprotocol.ConnectOK
				if err := json.Unmarshal(ackPayload, &connectOK); err != nil {
					handlerErrCh <- fmt.Errorf("expected connect ack to decode: %w", err)
					return
				}
				if connectOK.Type != sessionprotocol.MessageTypeConnectOK {
					handlerErrCh <- fmt.Errorf("expected connect ack type '%s', got '%s'", sessionprotocol.MessageTypeConnectOK, connectOK.Type)
					return
				}
				if connectOK.RequestID != "req_connect_agent" {
					handlerErrCh <- fmt.Errorf("expected connect ack requestId 'req_connect_agent', got '%s'", connectOK.RequestID)
					return
				}

				agentPayload := `{"jsonrpc":"2.0","id":"req-1","method":"ping"}`
				if err := conn.Write(handlerCtx, websocket.MessageText, []byte(agentPayload)); err != nil {
					handlerErrCh <- fmt.Errorf("expected gateway->runtime write to succeed: %w", err)
					return
				}

				responseType, responsePayload, err := conn.Read(handlerCtx)
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected runtime->gateway read to succeed: %w", err)
					return
				}
				if responseType != websocket.MessageText {
					handlerErrCh <- fmt.Errorf("expected runtime->gateway response to be text, got %s", responseType.String())
					return
				}
				gatewayResponseCh <- string(responsePayload)

				_ = conn.Close(websocket.StatusNormalClosure, "test completed")
			case "/tunnel/sandbox/sbi_tunnel_test_002/token-exchange":
				writeTestTunnelTokenExchangeResponse(
					t,
					writer,
					"rotated-bootstrap-token-002",
					testLongLivedTunnelExchangeToken(t),
				)
			default:
				handlerErrCh <- fmt.Errorf("unexpected request path %q", request.URL.Path)
			}
		}))
		defer gatewayServer.Close()

		gatewayWSURL := "ws" + strings.TrimPrefix(gatewayServer.URL, "http") + "/tunnel/sandbox/sbi_tunnel_test_002"
		agentWSURL := "ws" + strings.TrimPrefix(agentServer.URL, "http")

		err := Run(RunInput{
			Context:             runCtx,
			GatewayWSURL:        gatewayWSURL,
			BootstrapToken:      []byte("sandbox-bootstrap-token"),
			TunnelExchangeToken: testLongLivedTunnelExchangeToken(t),
			AgentRuntimes: []startup.AgentRuntime{
				{
					BindingID:   "bind_openai",
					RuntimeKey:  "codex-app-server",
					ClientID:    "client_codex",
					EndpointKey: "app-server",
				},
			},
			RuntimeClients: []startup.RuntimeClient{
				{
					ClientID: "client_codex",
					Setup: startup.RuntimeClientSetup{
						Env:   map[string]string{},
						Files: []startup.RuntimeFileSpec{},
					},
					Processes: []startup.RuntimeClientProcessSpec{},
					Endpoints: []startup.RuntimeClientEndpointSpec{
						{
							EndpointKey:    "app-server",
							ConnectionMode: "dedicated",
							ProcessKey:     "codex-app-server",
							Transport: startup.RuntimeClientEndpointTransport{
								Type: "ws",
								URL:  agentWSURL,
							},
						},
					},
				},
			},
		})
		if err != nil {
			t.Fatalf("expected run to stop cleanly after reconnect and context cancel, got %v", err)
		}

		select {
		case requestPayload := <-agentRequestCh:
			expectedPayload := `{"jsonrpc":"2.0","id":"req-1","method":"ping"}`
			if requestPayload != expectedPayload {
				t.Fatalf("expected forwarded gateway payload %q, got %q", expectedPayload, requestPayload)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("expected agent endpoint to receive forwarded payload")
		}

		select {
		case responsePayload := <-gatewayResponseCh:
			expectedPayload := `{"jsonrpc":"2.0","id":"res-1","result":{"ok":true}}`
			if responsePayload != expectedPayload {
				t.Fatalf("expected forwarded agent payload %q, got %q", expectedPayload, responsePayload)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("expected gateway to receive forwarded payload from agent")
		}

		select {
		case handlerErr := <-handlerErrCh:
			t.Fatalf("expected websocket handlers to succeed, got %v", handlerErr)
		default:
		}
	})

	t.Run("writes connect.error when agent endpoint is unavailable", func(t *testing.T) {
		responseCh := make(chan sessionprotocol.ConnectError, 1)
		handlerErrCh := make(chan error, 1)

		gatewayServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			conn, err := websocket.Accept(writer, request, nil)
			if err != nil {
				handlerErrCh <- fmt.Errorf("expected gateway websocket accept to succeed: %w", err)
				return
			}
			defer conn.CloseNow()

			handlerCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			connectRequestPayload, err := json.Marshal(sessionprotocol.AgentConnectRequest{
				Type:      sessionprotocol.MessageTypeConnect,
				V:         sessionprotocol.ProtocolVersion,
				RequestID: "req_connect_missing_endpoint",
				Channel: sessionprotocol.AgentConnectChannel{
					Kind: sessionprotocol.ChannelKindAgent,
				},
			})
			if err != nil {
				handlerErrCh <- fmt.Errorf("expected connect request payload marshal to succeed: %w", err)
				return
			}

			if err := conn.Write(handlerCtx, websocket.MessageText, connectRequestPayload); err != nil {
				handlerErrCh <- fmt.Errorf("expected connect request write to succeed: %w", err)
				return
			}

			messageType, payload, err := conn.Read(handlerCtx)
			if err != nil {
				handlerErrCh <- fmt.Errorf("expected connect error read to succeed: %w", err)
				return
			}
			if messageType != websocket.MessageText {
				handlerErrCh <- fmt.Errorf("expected connect error message type text, got %s", messageType.String())
				return
			}

			var connectError sessionprotocol.ConnectError
			if err := json.Unmarshal(payload, &connectError); err != nil {
				handlerErrCh <- fmt.Errorf("expected connect error decode to succeed: %w", err)
				return
			}
			responseCh <- connectError

			_, _, _ = conn.Read(handlerCtx)
		}))
		defer gatewayServer.Close()

		gatewayWSURL := "ws" + strings.TrimPrefix(gatewayServer.URL, "http") + "/tunnel/sandbox/sbi_tunnel_test_003"
		runCtx, cancel := context.WithCancel(context.Background())

		runErrCh := make(chan error, 1)
		go func() {
			runErrCh <- Run(RunInput{
				Context:             runCtx,
				GatewayWSURL:        gatewayWSURL,
				BootstrapToken:      []byte("sandbox-bootstrap-token"),
				TunnelExchangeToken: testLongLivedTunnelExchangeToken(t),
				AgentRuntimes:       []startup.AgentRuntime{},
				RuntimeClients:      []startup.RuntimeClient{},
			})
		}()

		var connectError sessionprotocol.ConnectError
		select {
		case connectError = <-responseCh:
		case <-time.After(3 * time.Second):
			t.Fatal("expected connect.error response from sandbox runtime")
		}

		if connectError.Type != sessionprotocol.MessageTypeConnectError {
			t.Fatalf("expected connect.error type '%s', got '%s'", sessionprotocol.MessageTypeConnectError, connectError.Type)
		}
		if connectError.RequestID != "req_connect_missing_endpoint" {
			t.Fatalf("expected connect.error requestId 'req_connect_missing_endpoint', got '%s'", connectError.RequestID)
		}
		if connectError.Code != connectErrorCodeAgentEndpointUnavailable {
			t.Fatalf("expected connect.error code '%s', got '%s'", connectErrorCodeAgentEndpointUnavailable, connectError.Code)
		}

		cancel()

		select {
		case runErr := <-runErrCh:
			if runErr != nil {
				t.Fatalf("expected run to stop cleanly after context cancel, got %v", runErr)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("expected run to return after context cancel")
		}

		select {
		case handlerErr := <-handlerErrCh:
			t.Fatalf("expected websocket handlers to succeed, got %v", handlerErr)
		default:
		}
	})

	t.Run("keeps bootstrap tunnel open for a second agent connection after the first closes", func(t *testing.T) {
		agentRequestCh := make(chan string, 2)
		handlerErrCh := make(chan error, 1)

		agentServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			conn, err := websocket.Accept(writer, request, nil)
			if err != nil {
				handlerErrCh <- fmt.Errorf("expected agent websocket accept to succeed: %w", err)
				return
			}
			defer conn.CloseNow()

			handlerCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			messageType, payload, err := conn.Read(handlerCtx)
			if err != nil {
				handlerErrCh <- fmt.Errorf("expected agent request read to succeed: %w", err)
				return
			}
			if messageType != websocket.MessageText {
				handlerErrCh <- fmt.Errorf("expected agent request to be text, got %s", messageType.String())
				return
			}
			agentRequestCh <- string(payload)

			if err := conn.Write(handlerCtx, websocket.MessageText, []byte(`{"jsonrpc":"2.0","id":"res-1","result":{"ok":true}}`)); err != nil {
				handlerErrCh <- fmt.Errorf("expected agent response write to succeed: %w", err)
				return
			}

			_ = conn.Close(websocket.StatusNormalClosure, "agent session completed")
		}))
		defer agentServer.Close()

		runCtx, cancelRun := context.WithCancel(context.Background())
		defer cancelRun()

		gatewayServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			conn, err := websocket.Accept(writer, request, nil)
			if err != nil {
				handlerErrCh <- fmt.Errorf("expected gateway websocket accept to succeed: %w", err)
				return
			}
			defer conn.CloseNow()

			handlerCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			for index := range 2 {
				connectRequestPayload, err := json.Marshal(sessionprotocol.AgentConnectRequest{
					Type:      sessionprotocol.MessageTypeConnect,
					V:         sessionprotocol.ProtocolVersion,
					RequestID: fmt.Sprintf("req_connect_agent_%d", index+1),
					Channel: sessionprotocol.AgentConnectChannel{
						Kind: sessionprotocol.ChannelKindAgent,
					},
				})
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected connect request payload marshal to succeed: %w", err)
					return
				}

				if err := conn.Write(handlerCtx, websocket.MessageText, connectRequestPayload); err != nil {
					handlerErrCh <- fmt.Errorf("expected connect request write to succeed: %w", err)
					return
				}

				ackType, ackPayload, err := conn.Read(handlerCtx)
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected connect ack read to succeed: %w", err)
					return
				}
				if ackType != websocket.MessageText {
					handlerErrCh <- fmt.Errorf("expected connect ack to be text, got %s", ackType.String())
					return
				}

				var connectOK sessionprotocol.ConnectOK
				if err := json.Unmarshal(ackPayload, &connectOK); err != nil {
					handlerErrCh <- fmt.Errorf("expected connect ack to decode: %w", err)
					return
				}
				expectedRequestID := fmt.Sprintf("req_connect_agent_%d", index+1)
				if connectOK.Type != sessionprotocol.MessageTypeConnectOK {
					handlerErrCh <- fmt.Errorf("expected connect ack type '%s', got '%s'", sessionprotocol.MessageTypeConnectOK, connectOK.Type)
					return
				}
				if connectOK.RequestID != expectedRequestID {
					handlerErrCh <- fmt.Errorf("expected connect ack requestId '%s', got '%s'", expectedRequestID, connectOK.RequestID)
					return
				}

				agentPayload := fmt.Sprintf(`{"jsonrpc":"2.0","id":"req-%d","method":"ping"}`, index+1)
				if err := conn.Write(handlerCtx, websocket.MessageText, []byte(agentPayload)); err != nil {
					handlerErrCh <- fmt.Errorf("expected gateway->runtime write to succeed: %w", err)
					return
				}

				responseType, responsePayload, err := conn.Read(handlerCtx)
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected runtime->gateway read to succeed: %w", err)
					return
				}
				if responseType != websocket.MessageText {
					handlerErrCh <- fmt.Errorf("expected runtime->gateway response to be text, got %s", responseType.String())
					return
				}
				expectedResponsePayload := `{"jsonrpc":"2.0","id":"res-1","result":{"ok":true}}`
				if string(responsePayload) != expectedResponsePayload {
					handlerErrCh <- fmt.Errorf("expected runtime->gateway response %q, got %q", expectedResponsePayload, string(responsePayload))
					return
				}

				if index == 0 {
					disconnectPayload, err := json.Marshal(sessionprotocol.Disconnect{
						Type:   sessionprotocol.MessageTypeDisconnect,
						Reason: "connection peer disconnected",
					})
					if err != nil {
						handlerErrCh <- fmt.Errorf("expected disconnect payload marshal to succeed: %w", err)
						return
					}
					if err := conn.Write(handlerCtx, websocket.MessageText, disconnectPayload); err != nil {
						handlerErrCh <- fmt.Errorf("expected disconnect control write to succeed: %w", err)
						return
					}
				}
			}

			cancelRun()
			time.Sleep(100 * time.Millisecond)
		}))
		defer gatewayServer.Close()

		gatewayWSURL := "ws" + strings.TrimPrefix(gatewayServer.URL, "http") + "/tunnel/sandbox/sbi_tunnel_test_004"
		agentWSURL := "ws" + strings.TrimPrefix(agentServer.URL, "http")

		runErrCh := make(chan error, 1)
		go func() {
			runErrCh <- Run(RunInput{
				Context:             runCtx,
				GatewayWSURL:        gatewayWSURL,
				BootstrapToken:      []byte("sandbox-bootstrap-token"),
				TunnelExchangeToken: testLongLivedTunnelExchangeToken(t),
				AgentRuntimes: []startup.AgentRuntime{
					{
						BindingID:   "bind_openai",
						RuntimeKey:  "codex-app-server",
						ClientID:    "client_codex",
						EndpointKey: "app-server",
					},
				},
				RuntimeClients: []startup.RuntimeClient{
					{
						ClientID: "client_codex",
						Setup: startup.RuntimeClientSetup{
							Env:   map[string]string{},
							Files: []startup.RuntimeFileSpec{},
						},
						Processes: []startup.RuntimeClientProcessSpec{},
						Endpoints: []startup.RuntimeClientEndpointSpec{
							{
								EndpointKey:    "app-server",
								ConnectionMode: "dedicated",
								ProcessKey:     "codex-app-server",
								Transport: startup.RuntimeClientEndpointTransport{
									Type: "ws",
									URL:  agentWSURL,
								},
							},
						},
					},
				},
			})
		}()

		for index := range 2 {
			select {
			case requestPayload := <-agentRequestCh:
				expectedPayload := fmt.Sprintf(`{"jsonrpc":"2.0","id":"req-%d","method":"ping"}`, index+1)
				if requestPayload != expectedPayload {
					t.Fatalf("expected forwarded gateway payload %q, got %q", expectedPayload, requestPayload)
				}
			case handlerErr := <-handlerErrCh:
				select {
				case runErr := <-runErrCh:
					t.Fatalf("expected websocket handlers to succeed, got %v (runErr=%v)", handlerErr, runErr)
				default:
					t.Fatalf("expected websocket handlers to succeed, got %v", handlerErr)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("expected agent endpoint to receive forwarded payload")
			}
		}

		select {
		case runErr := <-runErrCh:
			if runErr != nil {
				t.Fatalf("expected run to stop cleanly after context cancel, got %v", runErr)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("expected run to return after context cancel")
		}

		select {
		case handlerErr := <-handlerErrCh:
			t.Fatalf("expected websocket handlers to succeed, got %v", handlerErr)
		default:
		}
	})

	t.Run("connects to pty session, supports attach and resize, and closes cleanly", func(t *testing.T) {
		handlerErrCh := make(chan error, 1)
		runCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		gatewayConnectionCount := 0
		gatewayServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			switch request.URL.Path {
			case "/tunnel/sandbox/sbi_tunnel_test_pty_001":
				gatewayConnectionCount++
				conn, err := websocket.Accept(writer, request, nil)
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected gateway websocket accept to succeed: %w", err)
					return
				}
				defer conn.CloseNow()

				if gatewayConnectionCount == 2 {
					cancel()
					_ = conn.Close(websocket.StatusNormalClosure, "reconnect observed")
					return
				}

				handlerCtx, handlerCancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer handlerCancel()

				connectCreatePayload, err := json.Marshal(sessionprotocol.PTYConnectRequest{
					Type:      sessionprotocol.MessageTypeConnect,
					V:         sessionprotocol.ProtocolVersion,
					RequestID: "req_pty_create_001",
					Channel: sessionprotocol.PTYConnectChannel{
						Kind:    sessionprotocol.ChannelKindPTY,
						Session: sessionprotocol.PTYSessionModeCreate,
						Cols:    120,
						Rows:    40,
					},
				})
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected pty connect payload marshal to succeed: %w", err)
					return
				}
				if err := conn.Write(handlerCtx, websocket.MessageText, connectCreatePayload); err != nil {
					handlerErrCh <- fmt.Errorf("expected pty connect write to succeed: %w", err)
					return
				}

				foundCreateAck := false
				for range 12 {
					createAckType, createAckPayload, readErr := conn.Read(handlerCtx)
					if readErr != nil {
						handlerErrCh <- fmt.Errorf("expected pty connect ack read to succeed: %w", readErr)
						return
					}
					if createAckType != websocket.MessageText {
						continue
					}

					var createAck sessionprotocol.ConnectOK
					if err := json.Unmarshal(createAckPayload, &createAck); err != nil {
						continue
					}
					if createAck.Type == sessionprotocol.MessageTypeConnectOK && createAck.RequestID == "req_pty_create_001" {
						foundCreateAck = true
						break
					}
				}
				if !foundCreateAck {
					handlerErrCh <- fmt.Errorf("expected to receive pty connect ack for req_pty_create_001")
					return
				}

				connectAttachPayload, err := json.Marshal(sessionprotocol.PTYConnectRequest{
					Type:      sessionprotocol.MessageTypeConnect,
					V:         sessionprotocol.ProtocolVersion,
					RequestID: "req_pty_attach_001",
					Channel: sessionprotocol.PTYConnectChannel{
						Kind:    sessionprotocol.ChannelKindPTY,
						Session: sessionprotocol.PTYSessionModeAttach,
					},
				})
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected pty attach payload marshal to succeed: %w", err)
					return
				}
				if err := conn.Write(handlerCtx, websocket.MessageText, connectAttachPayload); err != nil {
					handlerErrCh <- fmt.Errorf("expected pty attach write to succeed: %w", err)
					return
				}

				foundAttachAck := false
				for range 12 {
					attachAckType, attachAckPayload, readErr := conn.Read(handlerCtx)
					if readErr != nil {
						handlerErrCh <- fmt.Errorf("expected pty attach ack read to succeed: %w", readErr)
						return
					}
					if attachAckType != websocket.MessageText {
						continue
					}

					var attachAck sessionprotocol.ConnectOK
					if err := json.Unmarshal(attachAckPayload, &attachAck); err != nil {
						continue
					}
					if attachAck.Type == sessionprotocol.MessageTypeConnectOK && attachAck.RequestID == "req_pty_attach_001" {
						foundAttachAck = true
						break
					}
				}
				if !foundAttachAck {
					handlerErrCh <- fmt.Errorf("expected to receive pty attach ack for req_pty_attach_001")
					return
				}

				resizePayload, err := json.Marshal(sessionprotocol.PTYResize{
					Type: sessionprotocol.MessageTypePTYResize,
					Cols: 100,
					Rows: 30,
				})
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected pty resize payload marshal to succeed: %w", err)
					return
				}
				if err := conn.Write(handlerCtx, websocket.MessageText, resizePayload); err != nil {
					handlerErrCh <- fmt.Errorf("expected pty resize write to succeed: %w", err)
					return
				}

				expectedToken := []byte("__MISTLE_PTY_TOKEN__")
				if err := conn.Write(handlerCtx, websocket.MessageBinary, []byte("printf '__MISTLE_PTY_TOKEN__\\n'\n")); err != nil {
					handlerErrCh <- fmt.Errorf("expected pty stdin write to succeed: %w", err)
					return
				}

				foundToken := false
				for range 12 {
					messageType, payload, readErr := conn.Read(handlerCtx)
					if readErr != nil {
						handlerErrCh <- fmt.Errorf("expected pty output read to succeed: %w", readErr)
						return
					}
					if messageType != websocket.MessageBinary {
						continue
					}
					if bytes.Contains(payload, expectedToken) {
						foundToken = true
						break
					}
				}
				if !foundToken {
					handlerErrCh <- fmt.Errorf("expected pty output to contain token %q", string(expectedToken))
					return
				}

				closePayload, err := json.Marshal(sessionprotocol.PTYClose{
					Type:      sessionprotocol.MessageTypePTYClose,
					RequestID: "req_pty_close_001",
				})
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected pty close payload marshal to succeed: %w", err)
					return
				}
				if err := conn.Write(handlerCtx, websocket.MessageText, closePayload); err != nil {
					handlerErrCh <- fmt.Errorf("expected pty close write to succeed: %w", err)
					return
				}

				foundCloseAck := false
				for range 12 {
					closeAckType, closeAckPayload, readErr := conn.Read(handlerCtx)
					if readErr != nil {
						handlerErrCh <- fmt.Errorf("expected pty close ack read to succeed: %w", readErr)
						return
					}
					if closeAckType != websocket.MessageText {
						continue
					}

					var closeAck sessionprotocol.PTYCloseOK
					if err := json.Unmarshal(closeAckPayload, &closeAck); err != nil {
						continue
					}
					if closeAck.Type == sessionprotocol.MessageTypePTYCloseOK && closeAck.RequestID == "req_pty_close_001" {
						foundCloseAck = true
						break
					}
				}
				if !foundCloseAck {
					handlerErrCh <- fmt.Errorf("expected to receive pty.close.ok for request req_pty_close_001")
					return
				}

				_ = conn.Close(websocket.StatusNormalClosure, "test completed")
			case "/tunnel/sandbox/sbi_tunnel_test_pty_001/token-exchange":
				writeTestTunnelTokenExchangeResponse(
					t,
					writer,
					"rotated-bootstrap-token-pty-001",
					testLongLivedTunnelExchangeToken(t),
				)
			default:
				handlerErrCh <- fmt.Errorf("unexpected request path %q", request.URL.Path)
			}
		}))
		defer gatewayServer.Close()

		gatewayWSURL := "ws" + strings.TrimPrefix(gatewayServer.URL, "http") + "/tunnel/sandbox/sbi_tunnel_test_pty_001"

		err := Run(RunInput{
			Context:             runCtx,
			GatewayWSURL:        gatewayWSURL,
			BootstrapToken:      []byte("sandbox-bootstrap-token"),
			TunnelExchangeToken: testLongLivedTunnelExchangeToken(t),
			RuntimeClients:      []startup.RuntimeClient{},
		})
		if err != nil {
			t.Fatalf("expected run to stop cleanly after reconnect and context cancel, got %v", err)
		}

		select {
		case handlerErr := <-handlerErrCh:
			t.Fatalf("expected websocket handlers to succeed, got %v", handlerErr)
		default:
		}
	})

	t.Run("sends pty.exit when process exits without pty.close", func(t *testing.T) {
		handlerErrCh := make(chan error, 1)
		runCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		gatewayConnectionCount := 0
		gatewayServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			switch request.URL.Path {
			case "/tunnel/sandbox/sbi_tunnel_test_pty_002":
				gatewayConnectionCount++
				conn, err := websocket.Accept(writer, request, nil)
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected gateway websocket accept to succeed: %w", err)
					return
				}
				defer conn.CloseNow()

				if gatewayConnectionCount == 2 {
					cancel()
					_ = conn.Close(websocket.StatusNormalClosure, "reconnect observed")
					return
				}

				handlerCtx, handlerCancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer handlerCancel()

				connectPayload, err := json.Marshal(sessionprotocol.PTYConnectRequest{
					Type:      sessionprotocol.MessageTypeConnect,
					V:         sessionprotocol.ProtocolVersion,
					RequestID: "req_pty_create_exit",
					Channel: sessionprotocol.PTYConnectChannel{
						Kind:    sessionprotocol.ChannelKindPTY,
						Session: sessionprotocol.PTYSessionModeCreate,
					},
				})
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected pty connect payload marshal to succeed: %w", err)
					return
				}
				if err := conn.Write(handlerCtx, websocket.MessageText, connectPayload); err != nil {
					handlerErrCh <- fmt.Errorf("expected pty connect write to succeed: %w", err)
					return
				}

				ackType, _, err := conn.Read(handlerCtx)
				if err != nil {
					handlerErrCh <- fmt.Errorf("expected pty connect ack read to succeed: %w", err)
					return
				}
				if ackType != websocket.MessageText {
					handlerErrCh <- fmt.Errorf("expected pty connect ack type text, got %s", ackType.String())
					return
				}

				if err := conn.Write(handlerCtx, websocket.MessageBinary, []byte("exit\n")); err != nil {
					handlerErrCh <- fmt.Errorf("expected pty stdin exit write to succeed: %w", err)
					return
				}

				foundExit := false
				for range 12 {
					messageType, payload, readErr := conn.Read(handlerCtx)
					if readErr != nil {
						handlerErrCh <- fmt.Errorf("expected pty message read to succeed: %w", readErr)
						return
					}
					if messageType != websocket.MessageText {
						continue
					}

					var exitMessage sessionprotocol.PTYExit
					if err := json.Unmarshal(payload, &exitMessage); err != nil {
						continue
					}
					if exitMessage.Type == sessionprotocol.MessageTypePTYExit {
						foundExit = true
						break
					}
				}
				if !foundExit {
					handlerErrCh <- fmt.Errorf("expected to receive pty.exit message")
					return
				}

				_ = conn.Close(websocket.StatusNormalClosure, "test completed")
			case "/tunnel/sandbox/sbi_tunnel_test_pty_002/token-exchange":
				writeTestTunnelTokenExchangeResponse(
					t,
					writer,
					"rotated-bootstrap-token-pty-002",
					testLongLivedTunnelExchangeToken(t),
				)
			default:
				handlerErrCh <- fmt.Errorf("unexpected request path %q", request.URL.Path)
			}
		}))
		defer gatewayServer.Close()

		gatewayWSURL := "ws" + strings.TrimPrefix(gatewayServer.URL, "http") + "/tunnel/sandbox/sbi_tunnel_test_pty_002"

		err := Run(RunInput{
			Context:             runCtx,
			GatewayWSURL:        gatewayWSURL,
			BootstrapToken:      []byte("sandbox-bootstrap-token"),
			TunnelExchangeToken: testLongLivedTunnelExchangeToken(t),
			RuntimeClients:      []startup.RuntimeClient{},
		})
		if err != nil {
			t.Fatalf("expected run to stop cleanly after reconnect and context cancel, got %v", err)
		}

		select {
		case handlerErr := <-handlerErrCh:
			t.Fatalf("expected websocket handlers to succeed, got %v", handlerErr)
		default:
		}
	})

	t.Run("writes connect.error when attaching to a missing pty session", func(t *testing.T) {
		responseCh := make(chan sessionprotocol.ConnectError, 1)
		handlerErrCh := make(chan error, 1)

		gatewayServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			conn, err := websocket.Accept(writer, request, nil)
			if err != nil {
				handlerErrCh <- fmt.Errorf("expected gateway websocket accept to succeed: %w", err)
				return
			}
			defer conn.CloseNow()

			handlerCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			connectAttachPayload, err := json.Marshal(sessionprotocol.PTYConnectRequest{
				Type:      sessionprotocol.MessageTypeConnect,
				V:         sessionprotocol.ProtocolVersion,
				RequestID: "req_pty_attach_missing",
				Channel: sessionprotocol.PTYConnectChannel{
					Kind:    sessionprotocol.ChannelKindPTY,
					Session: sessionprotocol.PTYSessionModeAttach,
				},
			})
			if err != nil {
				handlerErrCh <- fmt.Errorf("expected pty attach payload marshal to succeed: %w", err)
				return
			}

			if err := conn.Write(handlerCtx, websocket.MessageText, connectAttachPayload); err != nil {
				handlerErrCh <- fmt.Errorf("expected pty attach request write to succeed: %w", err)
				return
			}

			messageType, payload, err := conn.Read(handlerCtx)
			if err != nil {
				handlerErrCh <- fmt.Errorf("expected connect.error read to succeed: %w", err)
				return
			}
			if messageType != websocket.MessageText {
				handlerErrCh <- fmt.Errorf("expected connect.error message type text, got %s", messageType.String())
				return
			}

			var connectError sessionprotocol.ConnectError
			if err := json.Unmarshal(payload, &connectError); err != nil {
				handlerErrCh <- fmt.Errorf("expected connect.error decode to succeed: %w", err)
				return
			}
			responseCh <- connectError

			_, _, _ = conn.Read(handlerCtx)
		}))
		defer gatewayServer.Close()

		gatewayWSURL := "ws" + strings.TrimPrefix(gatewayServer.URL, "http") + "/tunnel/sandbox/sbi_tunnel_test_pty_003"
		runCtx, cancel := context.WithCancel(context.Background())

		runErrCh := make(chan error, 1)
		go func() {
			runErrCh <- Run(RunInput{
				Context:             runCtx,
				GatewayWSURL:        gatewayWSURL,
				BootstrapToken:      []byte("sandbox-bootstrap-token"),
				TunnelExchangeToken: testLongLivedTunnelExchangeToken(t),
				RuntimeClients:      []startup.RuntimeClient{},
			})
		}()

		var connectError sessionprotocol.ConnectError
		select {
		case connectError = <-responseCh:
		case <-time.After(3 * time.Second):
			t.Fatal("expected connect.error response for missing pty session")
		}

		if connectError.Type != sessionprotocol.MessageTypeConnectError {
			t.Fatalf("expected connect.error type '%s', got '%s'", sessionprotocol.MessageTypeConnectError, connectError.Type)
		}
		if connectError.RequestID != "req_pty_attach_missing" {
			t.Fatalf("expected connect.error requestId 'req_pty_attach_missing', got '%s'", connectError.RequestID)
		}
		if connectError.Code != connectErrorCodePTYSessionUnavailable {
			t.Fatalf("expected connect.error code '%s', got '%s'", connectErrorCodePTYSessionUnavailable, connectError.Code)
		}

		cancel()

		select {
		case runErr := <-runErrCh:
			if runErr != nil {
				t.Fatalf("expected run to stop cleanly after context cancel, got %v", runErr)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("expected run to return after context cancel")
		}

		select {
		case handlerErr := <-handlerErrCh:
			t.Fatalf("expected websocket handlers to succeed, got %v", handlerErr)
		default:
		}
	})
}
