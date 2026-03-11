package proxy

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/httpclient"
)

func TestHandlerServeHTTP(t *testing.T) {
	t.Run("forwards plain http proxy requests upstream", func(t *testing.T) {
		var capturedAuthHeader string
		var capturedConnectionHeader string
		var capturedProxyAuthorizationHeader string
		var capturedStrippedHeader string
		upstreamServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if request.Method != http.MethodGet {
				t.Fatalf("expected method GET, got %s", request.Method)
			}
			if request.URL.Path != "/v1/models" {
				t.Fatalf("expected path /v1/models, got %s", request.URL.Path)
			}
			if request.URL.RawQuery != "limit=1" {
				t.Fatalf("expected query limit=1, got %s", request.URL.RawQuery)
			}

			capturedAuthHeader = request.Header.Get("Authorization")
			capturedConnectionHeader = request.Header.Get("Connection")
			capturedProxyAuthorizationHeader = request.Header.Get("Proxy-Authorization")
			capturedStrippedHeader = request.Header.Get("X-Strip-Me")
			writer.Header().Set("Connection", "close, X-Upstream-Hop")
			writer.Header().Set("Proxy-Authenticate", "Basic realm=proxy")
			writer.Header().Set("Content-Type", "application/json")
			writer.Header().Set("X-Upstream-Hop", "should-not-forward")
			writer.WriteHeader(http.StatusAccepted)
			_, _ = io.WriteString(writer, `{"ok":true}`)
		}))
		defer upstreamServer.Close()

		handler, err := NewHandler(NewHandlerInput{
			HTTPClient: httpclient.NewDirectClient(http.DefaultClient),
		})
		if err != nil {
			t.Fatalf("expected handler creation to succeed, got %v", err)
		}

		absoluteURL, err := url.Parse(upstreamServer.URL + "/v1/models?limit=1")
		if err != nil {
			t.Fatalf("expected absolute url parse to succeed, got %v", err)
		}

		request := httptest.NewRequest(http.MethodGet, absoluteURL.String(), nil)
		request.URL = absoluteURL
		request.Header.Set("Authorization", "Bearer test-token")
		request.Header.Set("Connection", "keep-alive, X-Strip-Me")
		request.Header.Set("Proxy-Authorization", "Basic cHJveHk=")
		request.Header.Set("X-Strip-Me", "request-hop-by-hop")

		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusAccepted {
			t.Fatalf("expected status 202, got %d", recorder.Code)
		}
		if recorder.Body.String() != `{"ok":true}` {
			t.Fatalf("expected body from upstream, got %s", recorder.Body.String())
		}
		if capturedAuthHeader != "Bearer test-token" {
			t.Fatalf("expected auth header to be forwarded, got %s", capturedAuthHeader)
		}
		if capturedConnectionHeader != "" {
			t.Fatalf("expected Connection header to be stripped, got %s", capturedConnectionHeader)
		}
		if capturedProxyAuthorizationHeader != "" {
			t.Fatalf("expected Proxy-Authorization header to be stripped, got %s", capturedProxyAuthorizationHeader)
		}
		if capturedStrippedHeader != "" {
			t.Fatalf("expected connection-nominated header to be stripped, got %s", capturedStrippedHeader)
		}
		if recorder.Header().Get("Connection") != "" {
			t.Fatalf("expected Connection response header to be stripped, got %s", recorder.Header().Get("Connection"))
		}
		if recorder.Header().Get("Proxy-Authenticate") != "" {
			t.Fatalf(
				"expected Proxy-Authenticate response header to be stripped, got %s",
				recorder.Header().Get("Proxy-Authenticate"),
			)
		}
	})

	t.Run("rejects non-absolute proxy requests", func(t *testing.T) {
		handler, err := NewHandler(NewHandlerInput{
			HTTPClient: httpclient.NewDirectClient(http.DefaultClient),
		})
		if err != nil {
			t.Fatalf("expected handler creation to succeed, got %v", err)
		}

		request := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
		request.URL.Scheme = ""
		request.URL.Host = ""

		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected status 400, got %d", recorder.Code)
		}
	})

	t.Run("tunnels https connect traffic", func(t *testing.T) {
		upstreamListener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("expected upstream listener to start, got %v", err)
		}
		defer upstreamListener.Close()

		upstreamReceivedCh := make(chan string, 1)
		go func() {
			upstreamConn, acceptErr := upstreamListener.Accept()
			if acceptErr != nil {
				upstreamReceivedCh <- fmt.Sprintf("accept-error:%v", acceptErr)
				return
			}
			defer upstreamConn.Close()

			reader := bufio.NewReader(upstreamConn)
			payload, readErr := reader.ReadString('\n')
			if readErr != nil {
				upstreamReceivedCh <- fmt.Sprintf("read-error:%v", readErr)
				return
			}

			upstreamReceivedCh <- payload
			_, _ = io.WriteString(upstreamConn, "pong\n")
		}()

		handler, err := NewHandler(NewHandlerInput{
			HTTPClient: httpclient.NewDirectClient(http.DefaultClient),
		})
		if err != nil {
			t.Fatalf("expected handler creation to succeed, got %v", err)
		}

		proxyServer := httptest.NewServer(handler)
		defer proxyServer.Close()

		proxyURL, err := url.Parse(proxyServer.URL)
		if err != nil {
			t.Fatalf("expected proxy url parse to succeed, got %v", err)
		}

		proxyConn, err := net.Dial("tcp", proxyURL.Host)
		if err != nil {
			t.Fatalf("expected proxy dial to succeed, got %v", err)
		}
		defer proxyConn.Close()

		_, err = io.WriteString(
			proxyConn,
			fmt.Sprintf("CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", upstreamListener.Addr().String(), upstreamListener.Addr().String()),
		)
		if err != nil {
			t.Fatalf("expected connect request write to succeed, got %v", err)
		}

		proxyReader := bufio.NewReader(proxyConn)
		statusLine, err := proxyReader.ReadString('\n')
		if err != nil {
			t.Fatalf("expected connect status read to succeed, got %v", err)
		}
		if !strings.Contains(statusLine, "200 Connection Established") {
			t.Fatalf("expected connect success status, got %s", statusLine)
		}
		for {
			headerLine, headerErr := proxyReader.ReadString('\n')
			if headerErr != nil {
				t.Fatalf("expected connect header read to succeed, got %v", headerErr)
			}
			if headerLine == "\r\n" {
				break
			}
		}

		_, err = io.WriteString(proxyConn, "ping\n")
		if err != nil {
			t.Fatalf("expected tunneled write to succeed, got %v", err)
		}

		upstreamPayload := <-upstreamReceivedCh
		if upstreamPayload != "ping\n" {
			t.Fatalf("expected upstream to receive ping, got %s", upstreamPayload)
		}

		responsePayload, err := proxyReader.ReadString('\n')
		if err != nil {
			t.Fatalf("expected tunneled response read to succeed, got %v", err)
		}
		if responsePayload != "pong\n" {
			t.Fatalf("expected tunneled response pong, got %s", responsePayload)
		}
	})
}
