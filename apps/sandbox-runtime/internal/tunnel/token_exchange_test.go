package tunnel

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func makeTestTunnelExchangeToken(t *testing.T, issuedAt time.Time, expiresAt time.Time) string {
	t.Helper()

	headerBytes, err := json.Marshal(map[string]string{
		"alg": "HS256",
		"typ": "JWT",
	})
	if err != nil {
		t.Fatalf("expected JWT header marshal to succeed, got %v", err)
	}

	payloadBytes, err := json.Marshal(map[string]int64{
		"exp": expiresAt.Unix(),
		"iat": issuedAt.Unix(),
	})
	if err != nil {
		t.Fatalf("expected JWT payload marshal to succeed, got %v", err)
	}

	return fmt.Sprintf(
		"%s.%s.signature",
		base64.RawURLEncoding.EncodeToString(headerBytes),
		base64.RawURLEncoding.EncodeToString(payloadBytes),
	)
}

func testLongLivedTunnelExchangeToken(t *testing.T) string {
	t.Helper()

	issuedAt := time.Now().UTC()
	return makeTestTunnelExchangeToken(t, issuedAt, issuedAt.Add(24*time.Hour))
}

func TestBuildTunnelTokenExchangeURL(t *testing.T) {
	httpExchangeURL, err := buildTunnelTokenExchangeURL(
		"ws://127.0.0.1:5003/tunnel/sandbox/sbi_exchange_test_001",
	)
	if err != nil {
		t.Fatalf("expected ws exchange URL derivation to succeed, got %v", err)
	}
	if httpExchangeURL != "http://127.0.0.1:5003/tunnel/sandbox/sbi_exchange_test_001/token-exchange" {
		t.Fatalf("expected http exchange URL, got %q", httpExchangeURL)
	}

	httpsExchangeURL, err := buildTunnelTokenExchangeURL(
		"wss://gateway.mistle.dev/tunnel/sandbox/sbi_exchange_test_002",
	)
	if err != nil {
		t.Fatalf("expected wss exchange URL derivation to succeed, got %v", err)
	}
	if httpsExchangeURL != "https://gateway.mistle.dev/tunnel/sandbox/sbi_exchange_test_002/token-exchange" {
		t.Fatalf("expected https exchange URL, got %q", httpsExchangeURL)
	}
}

func TestRunRenewsTunnelExchangeTokenWhileTunnelIsHealthy(t *testing.T) {
	runContext, cancelRun := context.WithCancel(context.Background())
	defer cancelRun()

	initialExchangeToken := makeTestTunnelExchangeToken(
		t,
		time.Now().UTC().Add(-2*time.Minute),
		time.Now().UTC().Add(30*time.Second),
	)
	firstRotatedExchangeToken := makeTestTunnelExchangeToken(
		t,
		time.Now().UTC().Add(-2*time.Minute),
		time.Now().UTC().Add(30*time.Second),
	)
	secondRotatedExchangeToken := makeTestTunnelExchangeToken(
		t,
		time.Now().UTC(),
		time.Now().UTC().Add(30*time.Minute),
	)

	exchangeAuthorizationHeaders := make(chan string, 2)
	serverErrCh := make(chan error, 1)
	exchangeCallCount := 0

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.URL.Path == "/tunnel/sandbox/sbi_exchange_test_003":
			conn, err := websocket.Accept(writer, request, nil)
			if err != nil {
				serverErrCh <- fmt.Errorf("expected websocket accept to succeed: %w", err)
				return
			}
			defer conn.CloseNow()

			<-runContext.Done()
			_ = conn.Close(websocket.StatusNormalClosure, "test completed")
		case request.URL.Path == "/tunnel/sandbox/sbi_exchange_test_003/token-exchange":
			exchangeCallCount++
			exchangeAuthorizationHeaders <- request.Header.Get("authorization")

			writer.Header().Set("content-type", "application/json")
			switch exchangeCallCount {
			case 1:
				if err := json.NewEncoder(writer).Encode(tunnelTokenExchangeResponse{
					BootstrapToken:      "rotated-bootstrap-token-001",
					TunnelExchangeToken: firstRotatedExchangeToken,
				}); err != nil {
					serverErrCh <- fmt.Errorf("expected first exchange response encode to succeed: %w", err)
				}
			case 2:
				if err := json.NewEncoder(writer).Encode(tunnelTokenExchangeResponse{
					BootstrapToken:      "rotated-bootstrap-token-002",
					TunnelExchangeToken: secondRotatedExchangeToken,
				}); err != nil {
					serverErrCh <- fmt.Errorf("expected second exchange response encode to succeed: %w", err)
					return
				}
				cancelRun()
			default:
				serverErrCh <- fmt.Errorf("expected at most two exchange requests, got %d", exchangeCallCount)
			}
		default:
			serverErrCh <- fmt.Errorf("unexpected request path %q", request.URL.Path)
		}
	}))
	defer server.Close()

	gatewayWSURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sandbox/sbi_exchange_test_003"

	runErr := Run(RunInput{
		Context:             runContext,
		GatewayWSURL:        gatewayWSURL,
		BootstrapToken:      []byte("sandbox-bootstrap-token"),
		TunnelExchangeToken: initialExchangeToken,
	})
	if runErr != nil {
		t.Fatalf("expected run to stop cleanly after context cancel, got %v", runErr)
	}

	firstAuthorizationHeader := <-exchangeAuthorizationHeaders
	if firstAuthorizationHeader != "Bearer "+initialExchangeToken {
		t.Fatalf("expected first exchange to use initial token, got %q", firstAuthorizationHeader)
	}

	secondAuthorizationHeader := <-exchangeAuthorizationHeaders
	if secondAuthorizationHeader != "Bearer "+firstRotatedExchangeToken {
		t.Fatalf("expected second exchange to use rotated token, got %q", secondAuthorizationHeader)
	}

	select {
	case serverErr := <-serverErrCh:
		t.Fatalf("expected server interactions to succeed, got %v", serverErr)
	default:
	}
}

func TestRunRetriesTunnelTokenExchangeWithoutClosingTheTunnel(t *testing.T) {
	runContext, cancelRun := context.WithCancel(context.Background())
	defer cancelRun()

	initialExchangeToken := makeTestTunnelExchangeToken(
		t,
		time.Now().UTC().Add(-2*time.Minute),
		time.Now().UTC().Add(30*time.Second),
	)
	rotatedExchangeToken := makeTestTunnelExchangeToken(
		t,
		time.Now().UTC(),
		time.Now().UTC().Add(30*time.Minute),
	)

	exchangeAuthorizationHeaders := make(chan string, 2)
	serverErrCh := make(chan error, 1)
	exchangeCallCount := 0

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.URL.Path == "/tunnel/sandbox/sbi_exchange_test_004":
			conn, err := websocket.Accept(writer, request, nil)
			if err != nil {
				serverErrCh <- fmt.Errorf("expected websocket accept to succeed, got %v", err)
				return
			}
			defer conn.CloseNow()

			<-runContext.Done()
			_ = conn.Close(websocket.StatusNormalClosure, "test completed")
		case request.URL.Path == "/tunnel/sandbox/sbi_exchange_test_004/token-exchange":
			exchangeCallCount++
			exchangeAuthorizationHeaders <- request.Header.Get("authorization")

			if exchangeCallCount == 1 {
				http.Error(writer, "exchange failed", http.StatusInternalServerError)
				return
			}

			writer.Header().Set("content-type", "application/json")
			if err := json.NewEncoder(writer).Encode(tunnelTokenExchangeResponse{
				BootstrapToken:      "rotated-bootstrap-token-003",
				TunnelExchangeToken: rotatedExchangeToken,
			}); err != nil {
				serverErrCh <- fmt.Errorf("expected exchange response encode to succeed: %w", err)
				return
			}
			cancelRun()
		default:
			serverErrCh <- fmt.Errorf("unexpected request path %q", request.URL.Path)
		}
	}))
	defer server.Close()

	gatewayWSURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sandbox/sbi_exchange_test_004"

	runErr := Run(RunInput{
		Context:             runContext,
		GatewayWSURL:        gatewayWSURL,
		BootstrapToken:      []byte("sandbox-bootstrap-token"),
		TunnelExchangeToken: initialExchangeToken,
	})
	if runErr != nil {
		t.Fatalf("expected run to stop cleanly after retry and context cancel, got %v", runErr)
	}

	firstAuthorizationHeader := <-exchangeAuthorizationHeaders
	if firstAuthorizationHeader != "Bearer "+initialExchangeToken {
		t.Fatalf("expected first exchange to use initial token, got %q", firstAuthorizationHeader)
	}

	secondAuthorizationHeader := <-exchangeAuthorizationHeaders
	if secondAuthorizationHeader != "Bearer "+initialExchangeToken {
		t.Fatalf("expected retry exchange to reuse the current token, got %q", secondAuthorizationHeader)
	}

	select {
	case serverErr := <-serverErrCh:
		t.Fatalf("expected server interactions to succeed, got %v", serverErr)
	default:
	}
}

func TestRunIgnoresTokenExchangeFailureWhileTheTunnelIsStillHealthy(t *testing.T) {
	runContext, cancelRun := context.WithCancel(context.Background())
	defer cancelRun()

	initialExchangeToken := makeTestTunnelExchangeToken(
		t,
		time.Now().UTC().Add(-2*time.Minute),
		time.Now().UTC().Add(30*time.Second),
	)

	exchangeCallCount := 0

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.URL.Path == "/tunnel/sandbox/sbi_exchange_test_005":
			conn, err := websocket.Accept(writer, request, nil)
			if err != nil {
				t.Errorf("expected websocket accept to succeed, got %v", err)
				return
			}
			defer conn.CloseNow()

			<-runContext.Done()
			_ = conn.Close(websocket.StatusNormalClosure, "test completed")
		case request.URL.Path == "/tunnel/sandbox/sbi_exchange_test_005/token-exchange":
			exchangeCallCount++
			writer.Header().Set("content-type", "application/json")
			if err := json.NewEncoder(writer).Encode(tunnelTokenExchangeResponse{
				BootstrapToken:      "rotated-bootstrap-token",
				TunnelExchangeToken: "not-a-jwt",
			}); err != nil {
				t.Errorf("expected malformed exchange response encode to succeed, got %v", err)
			}
			cancelRun()
		default:
			t.Errorf("unexpected request path %q", request.URL.Path)
		}
	}))
	defer server.Close()

	gatewayWSURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sandbox/sbi_exchange_test_005"

	runErr := Run(RunInput{
		Context:             runContext,
		GatewayWSURL:        gatewayWSURL,
		BootstrapToken:      []byte("sandbox-bootstrap-token"),
		TunnelExchangeToken: initialExchangeToken,
	})
	if runErr != nil {
		t.Fatalf("expected run to stop cleanly after context cancel, got %v", runErr)
	}
	if exchangeCallCount != 1 {
		t.Fatalf("expected a single fatal exchange attempt, got %d", exchangeCallCount)
	}
}

func TestRunTunnelTokenExchangeLoopFailsWhenRotatedTokenIsMalformed(t *testing.T) {
	initialExchangeToken := makeTestTunnelExchangeToken(
		t,
		time.Now().UTC().Add(-2*time.Minute),
		time.Now().UTC().Add(30*time.Second),
	)

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/tunnel/sandbox/sbi_exchange_test_006/token-exchange" {
			t.Errorf("unexpected request path %q", request.URL.Path)
			return
		}

		writer.Header().Set("content-type", "application/json")
		if err := json.NewEncoder(writer).Encode(tunnelTokenExchangeResponse{
			BootstrapToken:      "rotated-bootstrap-token",
			TunnelExchangeToken: "not-a-jwt",
		}); err != nil {
			t.Errorf("expected malformed exchange response encode to succeed, got %v", err)
		}
	}))
	defer server.Close()

	loopErr := runTunnelTokenExchangeLoop(tunnelTokenExchangeLoopInput{
		Context:      context.Background(),
		GatewayWSURL: "ws" + strings.TrimPrefix(server.URL, "http") + "/tunnel/sandbox/sbi_exchange_test_006",
		HTTPClient:   server.Client(),
		Tokens: &tunnelTokens{
			bootstrapToken:      "sandbox-bootstrap-token",
			tunnelExchangeToken: initialExchangeToken,
		},
	})
	if loopErr == nil {
		t.Fatal("expected token exchange loop to fail when rotated exchange token is malformed")
	}
	if !strings.Contains(loopErr.Error(), "sandbox tunnel exchange token must be a JWT") {
		t.Fatalf("expected malformed token error, got %v", loopErr)
	}
}
