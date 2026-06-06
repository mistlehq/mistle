package egressproxy

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
)

type EgressTokenProvider interface {
	Token() (string, error)
}

type ProxyState struct {
	SandboxInstanceID string
	Routes            []Route
	DirectGateway     DirectGatewayEgressClient
	TokenProvider     EgressTokenProvider
	HTTPClient        *http.Client
	NextRequestID     atomic.Uint64
}

func RunProxyServer(listener net.Listener, state *ProxyState) error {
	if listener == nil {
		return fmt.Errorf("local egress proxy listener is required")
	}
	if state == nil {
		return fmt.Errorf("local egress proxy state is required")
	}
	server := &http.Server{
		Handler: ProxyHandler{State: state},
	}
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("local egress proxy server failed: %w", err)
	}
	return nil
}

type ProxyHandler struct {
	State *ProxyState
}

func (handler ProxyHandler) ServeHTTP(responseWriter http.ResponseWriter, request *http.Request) {
	if handler.State == nil {
		http.Error(responseWriter, "local egress proxy state is required", http.StatusBadGateway)
		return
	}
	if request.Method == http.MethodConnect {
		http.Error(responseWriter, "CONNECT egress proxy handling is not ported to Go yet", http.StatusBadGateway)
		return
	}
	if isWebSocketUpgradeRequest(request) {
		http.Error(responseWriter, "websocket egress proxy handling is not ported to Go yet", http.StatusBadGateway)
		return
	}

	response, err := ForwardProxyRequest(request, handler.State)
	if err != nil {
		http.Error(responseWriter, err.Error(), http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	copyResponse(responseWriter, response)
}

func ForwardProxyRequest(request *http.Request, state *ProxyState) (*http.Response, error) {
	if state == nil {
		return nil, fmt.Errorf("local egress proxy state is required")
	}
	requestTarget, err := ResolveRequestTarget(request, nil)
	if err != nil {
		return nil, err
	}
	route, err := MatchRoute(state.Routes, requestTarget.Host, requestPathAndQuery(request), request.Method)
	if err != nil {
		return nil, err
	}
	requestID := nextEgressProxyRequestID(state)
	if route == nil {
		return forwardDirectRequest(request, requestTarget, requestID, state)
	}
	return forwardDirectGatewayRequest(request, requestTarget, route, requestID, state)
}

func forwardDirectRequest(request *http.Request, requestTarget RequestTarget, requestID string, state *ProxyState) (*http.Response, error) {
	outboundRequest, err := buildOutboundRequest(request, requestTarget.URL.String(), request.Body)
	if err != nil {
		return nil, err
	}
	outboundRequest.Header = filterOutboundRequestHeaders(request.Header)
	outboundRequest.Header.Set(SandboxEgressRequestIDHeaderName, requestID)
	return proxyHTTPClient(state).Do(outboundRequest)
}

func forwardDirectGatewayRequest(request *http.Request, requestTarget RequestTarget, route *Route, requestID string, state *ProxyState) (*http.Response, error) {
	if state.TokenProvider == nil {
		return nil, fmt.Errorf("gateway egress token provider is required")
	}
	directGatewayURL, err := state.DirectGateway.DirectHTTPURL(requestTarget.URL.String())
	if err != nil {
		return nil, err
	}
	token, err := state.TokenProvider.Token()
	if err != nil {
		return nil, fmt.Errorf("failed to read gateway egress token: %w", err)
	}
	outboundRequest, err := buildOutboundRequest(request, directGatewayURL, request.Body)
	if err != nil {
		return nil, err
	}
	outboundRequest.Header = FilterDirectGatewayRequestHeaders(request.Header)
	outboundRequest.Header.Set(DirectGatewayEgressAuthorizationHeaderName, "Bearer "+token)
	outboundRequest.Header.Set(SandboxEgressRequestIDHeaderName, requestID)
	return proxyHTTPClient(state).Do(outboundRequest)
}

func buildOutboundRequest(source *http.Request, targetURL string, body io.Reader) (*http.Request, error) {
	outboundRequest, err := http.NewRequestWithContext(source.Context(), source.Method, targetURL, body)
	if err != nil {
		return nil, fmt.Errorf("failed to build egress proxy upstream request: %w", err)
	}
	return outboundRequest, nil
}

func copyResponse(responseWriter http.ResponseWriter, response *http.Response) {
	for name, values := range response.Header {
		for _, value := range values {
			responseWriter.Header().Add(name, value)
		}
	}
	responseWriter.WriteHeader(response.StatusCode)
	_, _ = io.Copy(responseWriter, response.Body)
}

func proxyHTTPClient(state *ProxyState) *http.Client {
	if state.HTTPClient != nil {
		return state.HTTPClient
	}
	return http.DefaultClient
}

func nextEgressProxyRequestID(state *ProxyState) string {
	value := state.NextRequestID.Add(1)
	return fmt.Sprintf("egp_%d", value)
}

func isWebSocketUpgradeRequest(request *http.Request) bool {
	connection := request.Header.Get("Connection")
	upgrade := request.Header.Get("Upgrade")
	if !strings.EqualFold(upgrade, "websocket") {
		return false
	}
	for _, token := range strings.Split(connection, ",") {
		if strings.EqualFold(strings.TrimSpace(token), "upgrade") {
			return true
		}
	}
	return false
}
