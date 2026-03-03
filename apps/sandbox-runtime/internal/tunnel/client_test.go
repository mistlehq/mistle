package tunnel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
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
}
