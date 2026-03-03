package tunnel

import (
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

func TestRun(t *testing.T) {
	t.Run("fails when context is missing", func(t *testing.T) {
		err := Run(RunInput{
			GatewayWSURL:   "ws://127.0.0.1:8090/tunnel/sandbox",
			BootstrapToken: []byte("token"),
		})
		if err == nil {
			t.Fatal("expected error when context is missing")
		}
	})

	t.Run("fails when bootstrap token is empty", func(t *testing.T) {
		err := Run(RunInput{
			Context:        context.Background(),
			GatewayWSURL:   "ws://127.0.0.1:8090/tunnel/sandbox",
			BootstrapToken: []byte(" \n\t "),
		})
		if err == nil {
			t.Fatal("expected error when bootstrap token is empty")
		}
	})

	t.Run("fails when gateway ws url uses unsupported scheme", func(t *testing.T) {
		err := Run(RunInput{
			Context:        context.Background(),
			GatewayWSURL:   "http://127.0.0.1:8090/tunnel/sandbox",
			BootstrapToken: []byte("token"),
		})
		if err == nil {
			t.Fatal("expected error when gateway ws url scheme is unsupported")
		}
	})

	t.Run("dials websocket with bootstrap token query", func(t *testing.T) {
		tokenQueryValues := make(chan string, 1)
		requestPathValues := make(chan string, 1)
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			tokenQueryValues <- request.URL.Query().Get(bootstrapTokenQueryParam)
			requestPathValues <- request.URL.Path

			conn, err := websocket.Accept(writer, request, nil)
			if err != nil {
				t.Errorf("expected websocket accept to succeed, got %v", err)
				return
			}
			defer conn.CloseNow()

			if err := conn.Close(websocket.StatusNormalClosure, "test completed"); err != nil {
				t.Errorf("expected websocket close to succeed, got %v", err)
			}
		}))
		defer server.Close()

		gatewayWSURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sandbox/sbi_tunnel_test_001"
		runCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		err := Run(RunInput{
			Context:        runCtx,
			GatewayWSURL:   gatewayWSURL,
			BootstrapToken: []byte("sandbox-bootstrap-token"),
		})
		if err == nil {
			t.Fatal("expected run to fail when websocket closes from server side")
		}

		if !strings.Contains(err.Error(), "sandbox tunnel websocket read failed") {
			t.Fatalf("expected websocket read failure error, got %v", err)
		}

		select {
		case queryToken := <-tokenQueryValues:
			if queryToken != "sandbox-bootstrap-token" {
				t.Fatalf("expected bootstrap token query to match, got %s", queryToken)
			}
		default:
			t.Fatal("expected token query to be recorded")
		}

		select {
		case requestPath := <-requestPathValues:
			if requestPath != "/tunnel/sandbox/sbi_tunnel_test_001" {
				t.Fatalf("expected request path to match, got %s", requestPath)
			}
		default:
			t.Fatal("expected request path to be recorded")
		}
	})

	t.Run("connects to agent endpoint and relays websocket frames", func(t *testing.T) {
		agentRequestCh := make(chan string, 1)
		gatewayResponseCh := make(chan string, 1)
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

			if err := conn.Close(websocket.StatusNormalClosure, "test completed"); err != nil {
				handlerErrCh <- fmt.Errorf("expected gateway websocket close to succeed: %w", err)
			}
		}))
		defer gatewayServer.Close()

		gatewayWSURL := "ws" + strings.TrimPrefix(gatewayServer.URL, "http") + "/tunnel/sandbox/sbi_tunnel_test_002"
		agentWSURL := "ws" + strings.TrimPrefix(agentServer.URL, "http")

		runCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		err := Run(RunInput{
			Context:        runCtx,
			GatewayWSURL:   gatewayWSURL,
			BootstrapToken: []byte("sandbox-bootstrap-token"),
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
		if err == nil {
			t.Fatal("expected run to fail when gateway closes websocket")
		}
		if !strings.Contains(err.Error(), "sandbox tunnel websocket relay failed") {
			t.Fatalf("expected relay failure after gateway close, got %v", err)
		}

		select {
		case requestPayload := <-agentRequestCh:
			expectedPayload := `{"jsonrpc":"2.0","id":"req-1","method":"ping"}`
			if requestPayload != expectedPayload {
				t.Fatalf("expected forwarded gateway payload %q, got %q", expectedPayload, requestPayload)
			}
		default:
			t.Fatal("expected agent endpoint to receive forwarded payload")
		}

		select {
		case responsePayload := <-gatewayResponseCh:
			expectedPayload := `{"jsonrpc":"2.0","id":"res-1","result":{"ok":true}}`
			if responsePayload != expectedPayload {
				t.Fatalf("expected forwarded agent payload %q, got %q", expectedPayload, responsePayload)
			}
		default:
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
				Context:        runCtx,
				GatewayWSURL:   gatewayWSURL,
				BootstrapToken: []byte("sandbox-bootstrap-token"),
				RuntimeClients: []startup.RuntimeClient{},
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
}

func TestResolveAgentEndpoint(t *testing.T) {
	t.Run("returns nil endpoint when runtime plan declares zero websocket endpoints", func(t *testing.T) {
		endpoint, err := resolveAgentEndpoint([]startup.RuntimeClient{})
		if err != nil {
			t.Fatalf("expected endpoint resolution to succeed for zero websocket endpoints, got %v", err)
		}
		if endpoint != nil {
			t.Fatal("expected nil endpoint when no websocket endpoint is declared")
		}
	})

	t.Run("fails when runtime plan declares multiple websocket endpoints", func(t *testing.T) {
		_, err := resolveAgentEndpoint([]startup.RuntimeClient{
			{
				ClientID: "client_one",
				Endpoints: []startup.RuntimeClientEndpointSpec{
					{
						EndpointKey:    "endpoint_one",
						ConnectionMode: "dedicated",
						Transport: startup.RuntimeClientEndpointTransport{
							Type: "ws",
							URL:  "ws://127.0.0.1:4500",
						},
					},
				},
			},
			{
				ClientID: "client_two",
				Endpoints: []startup.RuntimeClientEndpointSpec{
					{
						EndpointKey:    "endpoint_two",
						ConnectionMode: "dedicated",
						Transport: startup.RuntimeClientEndpointTransport{
							Type: "ws",
							URL:  "ws://127.0.0.1:4600",
						},
					},
				},
			},
		})
		if err == nil {
			t.Fatal("expected endpoint resolution to fail when multiple websocket endpoints are declared")
		}
	})

	t.Run("resolves single websocket endpoint", func(t *testing.T) {
		endpoint, err := resolveAgentEndpoint([]startup.RuntimeClient{
			{
				ClientID: "client_codex",
				Endpoints: []startup.RuntimeClientEndpointSpec{
					{
						EndpointKey:    "app-server",
						ConnectionMode: "dedicated",
						Transport: startup.RuntimeClientEndpointTransport{
							Type: "ws",
							URL:  "ws://127.0.0.1:4500",
						},
					},
				},
			},
		})
		if err != nil {
			t.Fatalf("expected endpoint resolution to succeed, got %v", err)
		}
		if endpoint == nil {
			t.Fatal("expected endpoint to be resolved")
		}
		if endpoint.ClientID != "client_codex" {
			t.Fatalf("expected clientId 'client_codex', got '%s'", endpoint.ClientID)
		}
		if endpoint.EndpointKey != "app-server" {
			t.Fatalf("expected endpointKey 'app-server', got '%s'", endpoint.EndpointKey)
		}
		if endpoint.ConnectionMode != "dedicated" {
			t.Fatalf("expected connection mode 'dedicated', got '%s'", endpoint.ConnectionMode)
		}
		if endpoint.TransportURL != "ws://127.0.0.1:4500" {
			t.Fatalf("expected transport url 'ws://127.0.0.1:4500', got '%s'", endpoint.TransportURL)
		}
	})
}
