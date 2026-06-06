package egressproxy

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestProxyServerForwardsUnmatchedHTTPRequestsDirectly(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.Method, http.MethodPost)
		assertEqual(t, request.URL.Path, "/v1/direct")
		assertEqual(t, request.URL.RawQuery, "q=1")
		assertEqual(t, request.Header.Get("Connection"), "")
		assertEqual(t, request.Header.Get("Proxy-Authorization"), "")
		if request.Header.Get(SandboxEgressRequestIDHeaderName) == "" {
			t.Fatalf("expected sandbox egress request id header")
		}
		body, err := io.ReadAll(request.Body)
		requireNoError(t, err)
		assertEqual(t, string(body), "request body")
		responseWriter.Header().Set("x-upstream", "direct")
		responseWriter.WriteHeader(http.StatusCreated)
		_, _ = responseWriter.Write([]byte("direct response"))
	}))
	defer upstream.Close()
	proxyURL := startHTTPProxyServer(t, &ProxyState{})
	client := http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	request, err := http.NewRequest(http.MethodPost, upstream.URL+"/v1/direct?q=1", strings.NewReader("request body"))
	requireNoError(t, err)
	request.Header.Set("Connection", "keep-alive")
	request.Header.Set("Proxy-Authorization", "secret")

	response, err := client.Do(request)

	requireNoError(t, err)
	defer response.Body.Close()
	assertEqual(t, response.StatusCode, http.StatusCreated)
	assertEqual(t, response.Header.Get("x-upstream"), "direct")
	body, err := io.ReadAll(response.Body)
	requireNoError(t, err)
	assertEqual(t, string(body), "direct response")
}

func TestProxyServerForwardsMatchedHTTPRequestsThroughDirectGateway(t *testing.T) {
	var gatewayTarget string
	gateway := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.URL.Path, DirectEgressHTTPRoutePath)
		gatewayTarget = request.URL.Query().Get("target")
		assertEqual(t, request.Header.Get(DirectGatewayEgressAuthorizationHeaderName), "Bearer gateway-token")
		assertEqual(t, request.Header.Get("Proxy-Connection"), "")
		if request.Header.Get(SandboxEgressRequestIDHeaderName) == "" {
			t.Fatalf("expected sandbox egress request id header")
		}
		body, err := io.ReadAll(request.Body)
		requireNoError(t, err)
		assertEqual(t, string(body), "gateway body")
		responseWriter.Header().Set("x-upstream", "gateway")
		responseWriter.WriteHeader(http.StatusAccepted)
		_, _ = responseWriter.Write([]byte("gateway response"))
	}))
	defer gateway.Close()
	gatewayURL, err := url.Parse(gateway.URL)
	requireNoError(t, err)
	gatewayURL.Scheme = "ws"
	proxyURL := startHTTPProxyServer(t, &ProxyState{
		Routes: []Route{{
			EgressRuleID: "egress-rule-a",
			Hosts:        []string{"api.example.test"},
			PathPrefixes: []string{"/v1"},
			Methods:      []string{"POST"},
		}},
		DirectGateway: mustDirectGatewayClient(t, gatewayURL.String()),
		TokenProvider: StaticEgressTokenProvider{TokenValue: "gateway-token"},
	})
	client := http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	request, err := http.NewRequest(http.MethodPost, "http://api.example.test/v1/allowed?x=1", strings.NewReader("gateway body"))
	requireNoError(t, err)
	request.Header.Set("Proxy-Connection", "keep-alive")

	response, err := client.Do(request)

	requireNoError(t, err)
	defer response.Body.Close()
	assertEqual(t, response.StatusCode, http.StatusAccepted)
	assertEqual(t, response.Header.Get("x-upstream"), "gateway")
	assertEqual(t, gatewayTarget, "http://api.example.test/v1/allowed?x=1")
	body, err := io.ReadAll(response.Body)
	requireNoError(t, err)
	assertEqual(t, string(body), "gateway response")
}

func TestProxyServerInterceptsConnectAndForwardsDecryptedHTTPSRequest(t *testing.T) {
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.Method, http.MethodGet)
		assertEqual(t, request.URL.Path, "/secure")
		assertEqual(t, request.Header.Get("Proxy-Authorization"), "")
		if request.Header.Get(SandboxEgressRequestIDHeaderName) == "" {
			t.Fatalf("expected upstream request id header")
		}
		responseWriter.Header().Set("x-upstream", "secure")
		_, _ = responseWriter.Write([]byte("secure response"))
	}))
	defer upstream.Close()
	generatedCA, err := GenerateProxyCA(time.Now())
	requireNoError(t, err)
	proxyURL := startHTTPProxyServer(t, &ProxyState{
		ProxyCACertPEM: generatedCA.CertificatePEM,
		ProxyCAKeyPEM:  generatedCA.PrivateKeyPEM,
		HTTPClient:     upstream.Client(),
	})
	proxyRoots := x509.NewCertPool()
	if !proxyRoots.AppendCertsFromPEM([]byte(generatedCA.CertificatePEM)) {
		t.Fatalf("expected proxy ca to be added to root pool")
	}
	client := http.Client{Transport: &http.Transport{
		Proxy: http.ProxyURL(proxyURL),
		TLSClientConfig: &tls.Config{
			RootCAs: proxyRoots,
		},
	}}
	request, err := http.NewRequest(http.MethodGet, upstream.URL+"/secure", nil)
	requireNoError(t, err)
	request.Header.Set("Proxy-Authorization", "secret")

	response, err := client.Do(request)

	requireNoError(t, err)
	defer response.Body.Close()
	assertEqual(t, response.StatusCode, http.StatusOK)
	assertEqual(t, response.Header.Get("x-upstream"), "secure")
	if response.Header.Get(SandboxEgressRequestIDHeaderName) == "" {
		t.Fatalf("expected downstream response id header")
	}
	body, err := io.ReadAll(response.Body)
	requireNoError(t, err)
	assertEqual(t, string(body), "secure response")
}

func TestProxyServerForwardsUnmatchedWebSocketUpgradesDirectly(t *testing.T) {
	upstream := startWebSocketEchoServer(t, func(request *http.Request) {
		assertEqual(t, request.URL.Path, "/ws/direct")
		assertEqual(t, request.Header.Get(SandboxEgressRequestIDHeaderName), "")
	})
	defer upstream.Close()
	proxyURL := startHTTPProxyServer(t, &ProxyState{})
	targetURL := websocketURLFromHTTPURL(t, upstream.URL+"/ws/direct")

	connection, response := dialWebSocketThroughProxy(t, targetURL, proxyURL)
	defer connection.Close(websocket.StatusNormalClosure, "")

	if response.Header.Get(SandboxEgressRequestIDHeaderName) == "" {
		t.Fatalf("expected downstream handshake to include request id")
	}
	writeWebSocketText(t, connection, "direct websocket")
	assertEqual(t, readWebSocketText(t, connection), "echo:direct websocket")
}

func TestProxyServerForwardsMatchedWebSocketUpgradesThroughDirectGateway(t *testing.T) {
	var gatewayTarget string
	gateway := startWebSocketEchoServer(t, func(request *http.Request) {
		assertEqual(t, request.URL.Path, DirectEgressWebSocketRoutePath)
		gatewayTarget = request.URL.Query().Get("target")
		assertEqual(t, request.Header.Get(DirectGatewayEgressAuthorizationHeaderName), "Bearer gateway-token")
	})
	defer gateway.Close()
	gatewayURL, err := url.Parse(gateway.URL)
	requireNoError(t, err)
	gatewayURL.Scheme = "ws"
	proxyURL := startHTTPProxyServer(t, &ProxyState{
		Routes: []Route{{
			EgressRuleID: "egress-rule-ws",
			Hosts:        []string{"api.example.test"},
			PathPrefixes: []string{"/v1"},
			Methods:      []string{"GET"},
		}},
		DirectGateway: mustDirectGatewayClient(t, gatewayURL.String()),
		TokenProvider: StaticEgressTokenProvider{TokenValue: "gateway-token"},
	})

	connection, response := dialWebSocketThroughProxy(t, "ws://api.example.test/v1/socket?x=1", proxyURL)
	defer connection.Close(websocket.StatusNormalClosure, "")

	if response.Header.Get(SandboxEgressRequestIDHeaderName) == "" {
		t.Fatalf("expected downstream handshake to include request id")
	}
	assertEqual(t, gatewayTarget, "ws://api.example.test/v1/socket?x=1")
	writeWebSocketText(t, connection, "gateway websocket")
	assertEqual(t, readWebSocketText(t, connection), "echo:gateway websocket")
}

func TestProxyServerReturnsBadGatewayForConnectRequestsWithoutProxyCA(t *testing.T) {
	request := httptest.NewRequest(http.MethodConnect, "http://example.test:443", nil)
	responseRecorder := httptest.NewRecorder()

	ProxyHandler{State: &ProxyState{}}.ServeHTTP(responseRecorder, request)

	assertEqual(t, responseRecorder.Code, http.StatusBadGateway)
	if !strings.Contains(responseRecorder.Body.String(), "proxy ca certificate pem is required for CONNECT") {
		t.Fatalf("expected explicit CONNECT error, got %q", responseRecorder.Body.String())
	}
}

func startHTTPProxyServer(t *testing.T, state *ProxyState) *url.URL {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	go func() {
		_ = RunProxyServer(listener, state)
	}()
	t.Cleanup(func() {
		_ = listener.Close()
	})
	proxyURL, err := url.Parse("http://" + listener.Addr().String())
	requireNoError(t, err)
	return proxyURL
}

func mustDirectGatewayClient(t *testing.T, tunnelGatewayURL string) DirectGatewayEgressClient {
	t.Helper()
	client, err := NewDirectGatewayEgressClient(tunnelGatewayURL)
	requireNoError(t, err)
	return client
}

func startWebSocketEchoServer(t *testing.T, inspect func(*http.Request)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if inspect != nil {
			inspect(request)
		}
		connection, err := websocket.Accept(writer, request, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			t.Errorf("expected websocket accept to succeed, got %v", err)
			return
		}
		defer connection.Close(websocket.StatusNormalClosure, "")
		messageType, payload, err := connection.Read(request.Context())
		if err != nil {
			t.Errorf("expected websocket message, got %v", err)
			return
		}
		if err := connection.Write(request.Context(), messageType, []byte("echo:"+string(payload))); err != nil {
			t.Errorf("expected websocket write to succeed, got %v", err)
		}
	}))
}

func websocketURLFromHTTPURL(t *testing.T, rawURL string) string {
	t.Helper()
	parsedURL, err := url.Parse(rawURL)
	requireNoError(t, err)
	parsedURL.Scheme = "ws"
	return parsedURL.String()
}

func dialWebSocketThroughProxy(t *testing.T, targetURL string, proxyURL *url.URL) (*websocket.Conn, *http.Response) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	connection, response, err := websocket.Dial(ctx, targetURL, &websocket.DialOptions{
		HTTPClient: &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}},
	})
	requireNoError(t, err)
	return connection, response
}

func writeWebSocketText(t *testing.T, connection *websocket.Conn, payload string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	requireNoError(t, connection.Write(ctx, websocket.MessageText, []byte(payload)))
}

func readWebSocketText(t *testing.T, connection *websocket.Conn) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	messageType, payload, err := connection.Read(ctx)
	requireNoError(t, err)
	assertEqual(t, messageType, websocket.MessageText)
	return string(payload)
}
