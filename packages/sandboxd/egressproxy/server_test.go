package egressproxy

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
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
		TokenProvider: staticTokenProvider{token: "gateway-token"},
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

func TestProxyServerReturnsBadGatewayForConnectRequests(t *testing.T) {
	request := httptest.NewRequest(http.MethodConnect, "http://example.test:443", nil)
	responseRecorder := httptest.NewRecorder()

	ProxyHandler{State: &ProxyState{}}.ServeHTTP(responseRecorder, request)

	assertEqual(t, responseRecorder.Code, http.StatusBadGateway)
	if !strings.Contains(responseRecorder.Body.String(), "CONNECT egress proxy handling is not ported to Go yet") {
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

type staticTokenProvider struct {
	token string
}

func (provider staticTokenProvider) Token() (string, error) {
	return provider.token, nil
}
