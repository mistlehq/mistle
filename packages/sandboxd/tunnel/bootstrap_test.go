package tunnel

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestConnectBootstrapTunnelAppendsBootstrapTokenAndSendsText(t *testing.T) {
	requests := make(chan bootstrapTunnelRequest, 1)
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.Close(websocket.StatusNormalClosure, "")
		_, payload, err := connection.Read(request.Context())
		if err != nil {
			return
		}
		requests <- bootstrapTunnelRequest{
			rawQuery: request.URL.RawQuery,
			payload:  string(payload),
		}
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sandbox/sbi_bootstrap?existing=1"

	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, " bootstrap-token ")
	requireNoError(t, err)
	defer tunnel.Close()
	requireNoError(t, tunnel.SendText(context.Background(), "hello"))

	request := receiveBootstrapTunnelRequest(t, requests)
	query, err := url.ParseQuery(request.rawQuery)
	requireNoError(t, err)
	assertEqual(t, query.Get("existing"), "1")
	assertEqual(t, query.Get("bootstrap_token"), "bootstrap-token")
	assertEqual(t, request.payload, "hello")
	if !strings.Contains(tunnel.ConnectedURL(), "bootstrap_token=bootstrap-token") {
		t.Fatalf("expected connected URL to include bootstrap token, got %q", tunnel.ConnectedURL())
	}
}

func TestConnectBootstrapTunnelRejectsInvalidInputs(t *testing.T) {
	_, missingTokenErr := ConnectBootstrapTunnel(context.Background(), "ws://gateway.example.test/tunnel/sbi", " ")
	_, invalidSchemeErr := ConnectBootstrapTunnel(context.Background(), "http://gateway.example.test/tunnel/sbi", "token")

	if missingTokenErr == nil {
		t.Fatalf("expected missing token to fail")
	}
	assertEqual(t, missingTokenErr.Error(), "sandbox tunnel bootstrap token is required")
	if invalidSchemeErr == nil {
		t.Fatalf("expected invalid scheme to fail")
	}
	assertEqual(t, invalidSchemeErr.Error(), "sandbox tunnel gateway ws url must use ws or wss scheme")
}

func TestConnectBootstrapTunnelReturnsErrorWhenInitialWebSocketNeverEstablishes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		hijacker, ok := responseWriter.(http.Hijacker)
		if !ok {
			t.Errorf("expected response writer to support hijacking")
			return
		}
		connection, _, err := hijacker.Hijack()
		if err != nil {
			t.Errorf("expected gateway connection hijack: %v", err)
			return
		}
		requireNoError(t, connection.Close())
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sandbox/sbi_bootstrap"

	_, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token")

	if err == nil {
		t.Fatalf("expected initial websocket establishment failure")
	}
	if !strings.Contains(err.Error(), "failed to connect bootstrap tunnel") {
		t.Fatalf("expected bootstrap connection error, got %v", err)
	}
}

func TestBootstrapTunnelSendAfterCloseFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.Close(websocket.StatusNormalClosure, "")
		_, _, _ = connection.Read(request.Context())
	}))
	defer server.Close()
	gatewayURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sandbox/sbi_bootstrap"
	tunnel, err := ConnectBootstrapTunnel(context.Background(), gatewayURL, "bootstrap-token")
	requireNoError(t, err)
	requireNoError(t, tunnel.Close())

	err = tunnel.SendText(context.Background(), "hello")

	if err == nil {
		t.Fatalf("expected send after close to fail")
	}
	assertEqual(t, err.Error(), "bootstrap tunnel is already closed")
}

func TestResolveTunnelExchangeURLPreservesGatewayQueryParameters(t *testing.T) {
	exchangeURL, err := ResolveTunnelExchangeURL("ws://127.0.0.1:5202/tunnel/sandbox/sbi_123?x-mistle-test-environment-id=test_env_123")
	requireNoError(t, err)

	assertEqual(t, exchangeURL, "http://127.0.0.1:5202/tunnel/sandbox/sbi_123/token-exchange?x-mistle-test-environment-id=test_env_123")
}

func TestExchangeTunnelTokenSendsBearerTokenAndReturnsRolledTokens(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.Method, http.MethodPost)
		assertEqual(t, request.URL.Path, "/tunnel/sandbox/sbi_123/token-exchange")
		assertEqual(t, request.URL.Query().Get("x-mistle-test-environment-id"), "test_env_123")
		assertEqual(t, request.Header.Get("Authorization"), "Bearer exchange-token-initial")
		assertEqual(t, request.Header.Get("Content-Length"), "0")
		responseWriter.Header().Set("Content-Type", "application/json")
		requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{
			"bootstrapToken":      "bootstrap-token-reconnect-1",
			"tunnelExchangeToken": "exchange-token-reconnect-1",
		}))
	}))
	defer server.Close()
	parsedURL, err := url.Parse(server.URL)
	requireNoError(t, err)
	parsedURL.Path = "/tunnel/sandbox/sbi_123/token-exchange"
	parsedURL.RawQuery = "x-mistle-test-environment-id=test_env_123"

	result, err := ExchangeTunnelToken(context.Background(), server.Client(), parsedURL.String(), " exchange-token-initial ")
	requireNoError(t, err)

	assertEqual(t, result.BootstrapToken, "bootstrap-token-reconnect-1")
	assertEqual(t, result.TunnelExchangeToken, "exchange-token-reconnect-1")
}

func TestExchangeTunnelTokenClassifiesTerminalAndRetryableFailures(t *testing.T) {
	for _, test := range []struct {
		name       string
		statusCode int
		expected   TunnelExchangeErrorKind
	}{
		{name: "unauthorized", statusCode: http.StatusUnauthorized, expected: TunnelExchangeErrorTerminal},
		{name: "not found", statusCode: http.StatusNotFound, expected: TunnelExchangeErrorTerminal},
		{name: "conflict", statusCode: http.StatusConflict, expected: TunnelExchangeErrorTerminal},
		{name: "too many requests", statusCode: http.StatusTooManyRequests, expected: TunnelExchangeErrorRetryable},
		{name: "server error", statusCode: http.StatusBadGateway, expected: TunnelExchangeErrorRetryable},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
				responseWriter.WriteHeader(test.statusCode)
				requireNoError(t, json.NewEncoder(responseWriter).Encode(map[string]string{"error": "exchange failed"}))
			}))
			defer server.Close()

			_, err := ExchangeTunnelToken(context.Background(), server.Client(), server.URL, "exchange-token")

			var exchangeErr *TunnelExchangeError
			if !errors.As(err, &exchangeErr) {
				t.Fatalf("expected TunnelExchangeError, got %v", err)
			}
			assertEqual(t, string(exchangeErr.Kind), string(test.expected))
			assertEqual(t, exchangeErr.Message, "exchange failed")
		})
	}
}

func TestExchangeTunnelTokenFormatsUnexpectedErrorBodiesLikeRust(t *testing.T) {
	for _, test := range []struct {
		name     string
		body     string
		expected string
	}{
		{
			name:     "empty body",
			body:     "",
			expected: "token exchange returned status 418 with an empty body",
		},
		{
			name:     "non json body",
			body:     "not-json",
			expected: "token exchange returned status 418 with a non-JSON body",
		},
		{
			name:     "unexpected json object",
			body:     `{"message":"wrong field"}`,
			expected: "token exchange returned unexpected status 418",
		},
		{
			name:     "unexpected json scalar",
			body:     `"teapot"`,
			expected: "token exchange returned status 418 with unexpected JSON body: teapot",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
				responseWriter.WriteHeader(http.StatusTeapot)
				_, err := responseWriter.Write([]byte(test.body))
				requireNoError(t, err)
			}))
			defer server.Close()

			_, err := ExchangeTunnelToken(context.Background(), server.Client(), server.URL, "exchange-token")

			var exchangeErr *TunnelExchangeError
			if !errors.As(err, &exchangeErr) {
				t.Fatalf("expected TunnelExchangeError, got %v", err)
			}
			assertEqual(t, exchangeErr.Message, test.expected)
			assertEqual(t, string(exchangeErr.Kind), string(TunnelExchangeErrorRetryable))
		})
	}
}

type bootstrapTunnelRequest struct {
	rawQuery string
	payload  string
}

func receiveBootstrapTunnelRequest(t *testing.T, requests <-chan bootstrapTunnelRequest) bootstrapTunnelRequest {
	t.Helper()
	select {
	case request := <-requests:
		return request
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for bootstrap websocket request")
		return bootstrapTunnelRequest{}
	}
}
