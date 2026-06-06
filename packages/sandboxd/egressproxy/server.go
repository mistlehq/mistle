package egressproxy

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"

	"github.com/coder/websocket"
)

type EgressTokenProvider interface {
	Token() (string, error)
}

type StaticEgressTokenProvider struct {
	TokenValue string
}

func (provider StaticEgressTokenProvider) Token() (string, error) {
	if provider.TokenValue == "" {
		return "", fmt.Errorf("gateway egress token is required")
	}
	return provider.TokenValue, nil
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
		if err := ForwardProxyWebSocket(responseWriter, request, handler.State); err != nil {
			http.Error(responseWriter, err.Error(), http.StatusBadGateway)
		}
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

func ForwardProxyWebSocket(responseWriter http.ResponseWriter, request *http.Request, state *ProxyState) error {
	if state == nil {
		return fmt.Errorf("local egress proxy state is required")
	}
	requestTarget, err := ResolveRequestTarget(request, nil)
	if err != nil {
		return err
	}
	route, err := MatchRoute(state.Routes, requestTarget.Host, requestPathAndQuery(request), request.Method)
	if err != nil {
		return err
	}
	requestID := nextEgressProxyRequestID(state)
	upstreamURL := ""
	upstreamHeaders := http.Header{}
	if route == nil {
		upstreamURL, err = WebSocketTargetURL(requestTarget.URL.String())
		if err != nil {
			return err
		}
	} else {
		if state.TokenProvider == nil {
			return fmt.Errorf("gateway egress token provider is required")
		}
		upstreamURL, err = state.DirectGateway.DirectWebSocketURL(requestTarget.URL.String())
		if err != nil {
			return err
		}
		token, err := state.TokenProvider.Token()
		if err != nil {
			return fmt.Errorf("failed to read gateway egress token: %w", err)
		}
		upstreamHeaders.Set(DirectGatewayEgressAuthorizationHeaderName, "Bearer "+token)
	}

	upstreamConnection, _, err := websocket.Dial(request.Context(), upstreamURL, &websocket.DialOptions{
		HTTPHeader: upstreamHeaders,
		HTTPClient: proxyHTTPClient(state),
	})
	if err != nil {
		return fmt.Errorf("websocket upstream connection failed: %w", err)
	}
	defer upstreamConnection.Close(websocket.StatusNormalClosure, "")

	responseWriter.Header().Set(SandboxEgressRequestIDHeaderName, requestID)
	downstreamConnection, err := websocket.Accept(responseWriter, request, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return fmt.Errorf("websocket downstream upgrade failed: %w", err)
	}
	defer downstreamConnection.Close(websocket.StatusNormalClosure, "")

	tunnelWebSockets(context.Background(), downstreamConnection, upstreamConnection)
	return nil
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

func tunnelWebSockets(parentContext context.Context, downstream *websocket.Conn, upstream *websocket.Conn) {
	tunnelContext, cancel := context.WithCancel(parentContext)
	defer cancel()
	done := make(chan struct{}, 2)
	go func() {
		copyWebSocketMessages(tunnelContext, upstream, downstream)
		cancel()
		done <- struct{}{}
	}()
	go func() {
		copyWebSocketMessages(tunnelContext, downstream, upstream)
		cancel()
		done <- struct{}{}
	}()
	<-done
}

func copyWebSocketMessages(ctx context.Context, destination *websocket.Conn, source *websocket.Conn) {
	for {
		messageType, payload, err := source.Read(ctx)
		if err != nil {
			_ = destination.Close(websocket.StatusNormalClosure, "")
			return
		}
		if err := destination.Write(ctx, messageType, payload); err != nil {
			_ = source.Close(websocket.StatusNormalClosure, "")
			return
		}
	}
}
