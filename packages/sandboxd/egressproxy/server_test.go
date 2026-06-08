package egressproxy

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
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

func TestProxyCAValidityIsLongLivedForSandboxInstanceReuse(t *testing.T) {
	assertEqual(t, proxyCAValidity, 10*365*24*time.Hour)
}

func TestGenerateProxyCAAndIssueLeafCertificate(t *testing.T) {
	now := time.Now()
	generatedProxyCA, err := GenerateProxyCA(now)
	requireNoError(t, err)

	if !strings.Contains(generatedProxyCA.CertificatePEM, "BEGIN CERTIFICATE") {
		t.Fatalf("expected generated proxy CA certificate PEM, got %q", generatedProxyCA.CertificatePEM)
	}
	if !strings.Contains(generatedProxyCA.PrivateKeyPEM, "BEGIN PRIVATE KEY") {
		t.Fatalf("expected generated proxy CA private key PEM, got %q", generatedProxyCA.PrivateKeyPEM)
	}
	leafCertificatePEM, leafPrivateKeyPEM, err := IssueProxyLeafCertificate(
		generatedProxyCA.CertificatePEM,
		generatedProxyCA.PrivateKeyPEM,
		"api.openai.com:443",
		now,
	)
	requireNoError(t, err)

	if !strings.Contains(leafCertificatePEM, "BEGIN CERTIFICATE") {
		t.Fatalf("expected leaf certificate PEM, got %q", leafCertificatePEM)
	}
	if !strings.Contains(leafPrivateKeyPEM, "BEGIN PRIVATE KEY") {
		t.Fatalf("expected leaf private key PEM, got %q", leafPrivateKeyPEM)
	}
	assertEqual(t, strings.Count(leafCertificatePEM, "BEGIN CERTIFICATE"), 2)
	certificatePool := x509.NewCertPool()
	if !certificatePool.AppendCertsFromPEM([]byte(generatedProxyCA.CertificatePEM)) {
		t.Fatalf("expected generated proxy CA to be parseable as a root certificate")
	}
}

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
	proxyURL := startHTTPProxyServer(t, &ProxyState{HTTPClient: upstream.Client()})
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

func TestForwardProxyRequestEmitsStructuredRequestLogs(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		responseWriter.WriteHeader(http.StatusCreated)
		_, _ = responseWriter.Write([]byte("created"))
	}))
	defer upstream.Close()
	var logs bytes.Buffer
	request, err := http.NewRequest(http.MethodGet, upstream.URL+"/v1/direct", nil)
	requireNoError(t, err)
	state := &ProxyState{
		SandboxInstanceID: "sbi_logs",
		LogOutput:         &logs,
	}

	response, err := ForwardProxyRequest(request, state, nil)

	requireNoError(t, err)
	defer response.Body.Close()
	assertEqual(t, response.StatusCode, http.StatusCreated)
	body, err := io.ReadAll(response.Body)
	requireNoError(t, err)
	assertEqual(t, string(body), "created")
	records := parseEgressLogRecords(t, logs.String())
	requireEgressLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "egress_proxy_request_started" &&
			record["sandboxInstanceId"] == "sbi_logs" &&
			record["requestId"] == "egp_1" &&
			record["method"] == http.MethodGet
	})
	requireEgressLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "egress_proxy_request_completed" &&
			record["requestId"] == "egp_1" &&
			record["routeMode"] == "direct" &&
			record["upstreamStatus"] == float64(http.StatusCreated)
	})
	requireEgressLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "egress_proxy_response_body_first_chunk" &&
			record["requestId"] == "egp_1" &&
			record["routeMode"] == "direct" &&
			record["upstreamStatus"] == float64(http.StatusCreated) &&
			record["firstChunkLatencyMs"] != nil
	})
	requireEgressLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "egress_proxy_response_body_completed" &&
			record["requestId"] == "egp_1" &&
			record["routeMode"] == "direct" &&
			record["upstreamStatus"] == float64(http.StatusCreated) &&
			record["outcome"] == "completed" &&
			record["chunkCount"] == float64(1) &&
			record["forwardedBytes"] == float64(len("created")) &&
			record["bytesRead"] == float64(len("created"))
	})
}

func TestCopyResponseFiltersHopByHopHeaders(t *testing.T) {
	response := &http.Response{
		StatusCode: http.StatusAccepted,
		Header: http.Header{
			"Connection":         []string{"x-remove, keep-alive"},
			"Keep-Alive":         []string{"timeout=5"},
			"Proxy-Authenticate": []string{"Basic"},
			"Transfer-Encoding":  []string{"chunked"},
			"Upgrade":            []string{"websocket"},
			"X-Remove":           []string{"connection-nominated"},
			"X-Keep":             []string{"preserved"},
		},
		Body: io.NopCloser(strings.NewReader("response body")),
	}
	recorder := httptest.NewRecorder()

	copyResponse(recorder, response)

	result := recorder.Result()
	defer result.Body.Close()
	assertEqual(t, result.StatusCode, http.StatusAccepted)
	assertEqual(t, result.Header.Get("Connection"), "")
	assertEqual(t, result.Header.Get("Keep-Alive"), "")
	assertEqual(t, result.Header.Get("Proxy-Authenticate"), "")
	assertEqual(t, result.Header.Get("Transfer-Encoding"), "")
	assertEqual(t, result.Header.Get("Upgrade"), "")
	assertEqual(t, result.Header.Get("X-Remove"), "")
	assertEqual(t, result.Header.Get("X-Keep"), "preserved")
	body, err := io.ReadAll(result.Body)
	requireNoError(t, err)
	assertEqual(t, string(body), "response body")
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
		HTTPClient:    gateway.Client(),
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

func TestTransparentPlainHTTPConnectionForwardsThroughDirectGateway(t *testing.T) {
	var gatewayTarget string
	gateway := startLoopbackHTTPServer(t, http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.URL.Path, DirectEgressHTTPRoutePath)
		gatewayTarget = request.URL.Query().Get("target")
		assertEqual(t, request.Header.Get(DirectGatewayEgressAuthorizationHeaderName), "Bearer gateway-token")
		responseWriter.WriteHeader(http.StatusAccepted)
		_, _ = responseWriter.Write([]byte("transparent gateway response"))
	}))
	defer gateway.Close()
	gatewayURL, err := url.Parse(gateway.URL)
	requireNoError(t, err)
	gatewayURL.Scheme = "ws"
	serverConnection, clientConnection := net.Pipe()
	var logs bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- handleTransparentProxyConnection(serverConnection, &net.TCPAddr{IP: net.ParseIP("203.0.113.10"), Port: 80}, &ProxyState{
			SandboxInstanceID: "sbi_transparent",
			Routes: []Route{{
				EgressRuleID: "egress-rule-transparent",
				Hosts:        []string{"api.example.test"},
				PathPrefixes: []string{"/v1"},
				Methods:      []string{"GET"},
			}},
			DirectGateway: mustDirectGatewayClient(t, gatewayURL.String()),
			TokenProvider: StaticEgressTokenProvider{TokenValue: "gateway-token"},
			HTTPClient:    gateway.Client(),
			LogOutput:     &logs,
		})
	}()
	defer waitForTransparentProxyConnection(t, done)

	_, err = clientConnection.Write([]byte("GET /v1/models?limit=1 HTTP/1.1\r\nHost: api.example.test\r\nConnection: close\r\n\r\n"))
	requireNoError(t, err)
	response, err := http.ReadResponse(bufio.NewReader(clientConnection), nil)
	requireNoError(t, err)
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	requireNoError(t, err)
	requireNoError(t, clientConnection.Close())

	assertEqual(t, response.StatusCode, http.StatusAccepted)
	assertEqual(t, string(body), "transparent gateway response")
	assertEqual(t, gatewayTarget, "http://api.example.test/v1/models?limit=1")
	records := parseEgressLogRecords(t, logs.String())
	requireEgressLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "egress_proxy_transparent_connection_started" &&
			record["sandboxInstanceId"] == "sbi_transparent" &&
			record["detectedProtocol"] == "http" &&
			record["scheme"] == "http" &&
			record["authority"] == "203.0.113.10:80"
	})
	requireEgressLogRecord(t, records, func(record map[string]any) bool {
		return record["event"] == "egress_proxy_request_completed" &&
			record["routeMode"] == "direct_gateway"
	})
}

func TestTransparentTLSConnectionUsesSNIForInterceptCertificateAndForwardTarget(t *testing.T) {
	var gatewayTarget string
	gateway := startLoopbackHTTPServer(t, http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.URL.Path, DirectEgressHTTPRoutePath)
		gatewayTarget = request.URL.Query().Get("target")
		assertEqual(t, request.Header.Get(DirectGatewayEgressAuthorizationHeaderName), "Bearer gateway-token")
		responseWriter.WriteHeader(http.StatusAccepted)
		_, _ = responseWriter.Write([]byte("transparent tls gateway response"))
	}))
	defer gateway.Close()
	gatewayURL, err := url.Parse(gateway.URL)
	requireNoError(t, err)
	gatewayURL.Scheme = "ws"
	generatedCA, err := GenerateProxyCA(time.Now())
	requireNoError(t, err)
	proxyRoots := x509.NewCertPool()
	if !proxyRoots.AppendCertsFromPEM([]byte(generatedCA.CertificatePEM)) {
		t.Fatalf("expected proxy ca to be added to root pool")
	}
	serverConnection, clientConnection := net.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- handleTransparentProxyConnection(serverConnection, &net.TCPAddr{IP: net.ParseIP("203.0.113.20"), Port: 443}, &ProxyState{
			Routes: []Route{{
				EgressRuleID: "egress-rule-transparent-tls",
				Hosts:        []string{"api.example.test"},
				PathPrefixes: []string{"/v1"},
				Methods:      []string{"GET"},
			}},
			DirectGateway:  mustDirectGatewayClient(t, gatewayURL.String()),
			TokenProvider:  StaticEgressTokenProvider{TokenValue: "gateway-token"},
			HTTPClient:     gateway.Client(),
			ProxyCACertPEM: generatedCA.CertificatePEM,
			ProxyCAKeyPEM:  generatedCA.PrivateKeyPEM,
		})
	}()
	defer waitForTransparentProxyConnection(t, done)

	tlsClient := tls.Client(clientConnection, &tls.Config{
		ServerName: "api.example.test",
		RootCAs:    proxyRoots,
		MinVersion: tls.VersionTLS12,
	})
	_, err = tlsClient.Write([]byte("GET /v1/secure HTTP/1.1\r\nHost: api.example.test\r\nConnection: close\r\n\r\n"))
	requireNoError(t, err)
	response, err := http.ReadResponse(bufio.NewReader(tlsClient), nil)
	requireNoError(t, err)
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	requireNoError(t, err)
	requireNoError(t, clientConnection.Close())

	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("expected %d, got %d with body %q", http.StatusAccepted, response.StatusCode, string(body))
	}
	assertEqual(t, string(body), "transparent tls gateway response")
	assertEqual(t, gatewayTarget, "https://api.example.test/v1/secure")
}

func TestProxyServerForwardsUnmatchedWebSocketUpgradesDirectly(t *testing.T) {
	upstream := startWebSocketEchoServer(t, func(request *http.Request) {
		assertEqual(t, request.URL.Path, "/ws/direct")
		assertEqual(t, request.Header.Get(SandboxEgressRequestIDHeaderName), "")
	})
	defer upstream.Close()
	proxyURL := startHTTPProxyServer(t, &ProxyState{HTTPClient: upstream.Client()})
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
		HTTPClient:    gateway.Client(),
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

func startLoopbackHTTPServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	requireNoError(t, err)
	server := httptest.NewUnstartedServer(handler)
	server.Listener = listener
	server.Start()
	return server
}

func mustDirectGatewayClient(t *testing.T, tunnelGatewayURL string) DirectGatewayEgressClient {
	t.Helper()
	client, err := NewDirectGatewayEgressClient(tunnelGatewayURL)
	requireNoError(t, err)
	return client
}

func startWebSocketEchoServer(t *testing.T, inspect func(*http.Request)) *httptest.Server {
	t.Helper()
	return startLoopbackHTTPServer(t, http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
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
	if err != nil {
		responseBody := ""
		if response != nil && response.Body != nil {
			payload, readErr := io.ReadAll(response.Body)
			if readErr == nil {
				responseBody = string(payload)
			}
		}
		t.Fatalf("expected no error, got %v with body %q", err, responseBody)
	}
	return connection, response
}

func waitForTransparentProxyConnection(t *testing.T, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		requireNoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for transparent proxy connection")
	}
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

func parseEgressLogRecords(t *testing.T, text string) []map[string]any {
	t.Helper()
	scanner := bufio.NewScanner(strings.NewReader(text))
	var records []map[string]any
	for scanner.Scan() {
		var record map[string]any
		requireNoError(t, json.Unmarshal(scanner.Bytes(), &record))
		records = append(records, record)
	}
	requireNoError(t, scanner.Err())
	return records
}

func requireEgressLogRecord(t *testing.T, records []map[string]any, matches func(map[string]any) bool) {
	t.Helper()
	for _, record := range records {
		if matches(record) {
			return
		}
	}
	t.Fatalf("expected matching egress log record in %#v", records)
}
