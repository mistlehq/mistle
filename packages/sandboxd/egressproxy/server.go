package egressproxy

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/timeutil"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

var timeNow = time.Now

type EgressTokenProvider interface {
	Token() (tunnelprotocol.EgressToken, error)
}

type StaticEgressTokenProvider struct {
	TokenValue string
}

func (provider StaticEgressTokenProvider) Token() (tunnelprotocol.EgressToken, error) {
	if provider.TokenValue == "" {
		return tunnelprotocol.EgressToken{}, fmt.Errorf("gateway egress token is required")
	}
	return tunnelprotocol.EgressToken{Token: provider.TokenValue}, nil
}

type ProxyState struct {
	SandboxInstanceID string
	Routes            []Route
	DirectGateway     DirectGatewayEgressClient
	TokenProvider     EgressTokenProvider
	HTTPClient        *http.Client
	ProxyCACertPEM    string
	ProxyCAKeyPEM     string
	NextRequestID     atomic.Uint64
	LogOutput         io.Writer
	httpClientOnce    sync.Once
	httpClient        *http.Client
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

func RunTransparentProxyServer(listener net.Listener, state *ProxyState) error {
	if listener == nil {
		return fmt.Errorf("transparent egress proxy listener is required")
	}
	if state == nil {
		return fmt.Errorf("transparent egress proxy state is required")
	}
	for {
		connection, err := listener.Accept()
		if err != nil {
			if errorsIsClosedNetworkConnection(err) {
				return nil
			}
			return fmt.Errorf("transparent egress proxy accept failed: %w", err)
		}
		go func() {
			defer connection.Close()
			originalDestination, err := RecoverOriginalDestination(connection)
			if err != nil {
				emitProxyRequestLog(state, "egress_proxy_transparent_connection_failed", map[string]any{
					"error": err.Error(),
				})
				return
			}
			if err := handleTransparentProxyConnection(connection, originalDestination, state); err != nil {
				emitProxyRequestLog(state, "egress_proxy_transparent_connection_failed", map[string]any{
					"originalDestination": originalDestination.String(),
					"error":               err.Error(),
				})
			}
		}()
	}
}

type ProxyHandler struct {
	State          *ProxyState
	TargetOverride *RequestTargetOverride
}

func (handler ProxyHandler) ServeHTTP(responseWriter http.ResponseWriter, request *http.Request) {
	if handler.State == nil {
		http.Error(responseWriter, "local egress proxy state is required", http.StatusBadGateway)
		return
	}
	if request.Method == http.MethodConnect {
		if err := HandleConnectRequest(responseWriter, request, handler.State); err != nil {
			http.Error(responseWriter, err.Error(), http.StatusBadGateway)
		}
		return
	}
	if isWebSocketUpgradeRequest(request) {
		if err := ForwardProxyWebSocket(responseWriter, request, handler.State, handler.TargetOverride); err != nil {
			http.Error(responseWriter, err.Error(), http.StatusBadGateway)
		}
		return
	}

	response, err := ForwardProxyRequest(request, handler.State, handler.TargetOverride)
	if err != nil {
		http.Error(responseWriter, err.Error(), http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	copyResponse(responseWriter, response)
}

func ForwardProxyRequest(request *http.Request, state *ProxyState, targetOverride *RequestTargetOverride) (*http.Response, error) {
	if state == nil {
		return nil, fmt.Errorf("local egress proxy state is required")
	}
	requestTarget, err := ResolveRequestTarget(request, targetOverride)
	if err != nil {
		return nil, err
	}
	route, err := MatchRoute(state.Routes, requestTarget.Host, requestPathAndQuery(request), request.Method)
	if err != nil {
		return nil, err
	}
	requestID := nextEgressProxyRequestID(state)
	emitProxyRequestLog(state, "egress_proxy_request_started", map[string]any{
		"requestId": requestID,
		"method":    request.Method,
		"target":    requestTarget.URL.String(),
	})
	if route == nil {
		response, err := forwardDirectRequest(request, requestTarget, requestID, state, targetOverride)
		emitProxyRequestResultLog(state, requestID, "direct", response, err)
		return response, err
	}
	response, err := forwardDirectGatewayRequest(request, requestTarget, route, requestID, state)
	emitProxyRequestResultLog(state, requestID, "direct_gateway", response, err)
	return response, err
}

func emitProxyRequestResultLog(state *ProxyState, requestID string, routeMode string, response *http.Response, err error) {
	if err != nil {
		emitProxyRequestLog(state, "egress_proxy_request_failed", map[string]any{
			"requestId": requestID,
			"routeMode": routeMode,
			"error":     err.Error(),
		})
		return
	}
	statusCode := 0
	if response != nil {
		statusCode = response.StatusCode
	}
	emitProxyRequestLog(state, "egress_proxy_request_completed", map[string]any{
		"requestId":      requestID,
		"routeMode":      routeMode,
		"upstreamStatus": statusCode,
	})
	if response != nil && response.Body != nil {
		response.Body = &loggingResponseBody{
			ReadCloser:      response.Body,
			state:           state,
			requestID:       requestID,
			routeMode:       routeMode,
			upstreamStatus:  statusCode,
			upstreamTraceID: response.Header.Get("traceparent"),
			startedAt:       timeNow(),
		}
	}
}

func emitProxyRequestLog(state *ProxyState, event string, fields map[string]any) {
	if state == nil {
		return
	}
	writer := state.LogOutput
	if writer == nil {
		_ = EmitLog(timeutil.SystemClock{}, state.SandboxInstanceID, event, fields)
		return
	}
	_ = EmitLogTo(writer, timeutil.SystemClock{}, state.SandboxInstanceID, event, fields)
}

func ForwardProxyWebSocket(responseWriter http.ResponseWriter, request *http.Request, state *ProxyState, targetOverride *RequestTargetOverride) error {
	if state == nil {
		return fmt.Errorf("local egress proxy state is required")
	}
	requestTarget, err := ResolveRequestTarget(request, targetOverride)
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
	routeMode := "direct"
	if route == nil {
		upstreamURL, err = WebSocketTargetURL(requestTarget.URL.String())
		if err != nil {
			return err
		}
	} else {
		routeMode = "direct_gateway"
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
		upstreamHeaders.Set(DirectGatewayEgressAuthorizationHeaderName, "Bearer "+token.Token)
	}
	emitProxyRequestLog(state, "egress_proxy_upgrade_started", map[string]any{
		"requestId": requestID,
		"method":    request.Method,
		"target":    requestTarget.URL.String(),
		"routeMode": routeMode,
		"upgrade":   "websocket",
	})

	upstreamConnection, _, err := websocket.Dial(request.Context(), upstreamURL, &websocket.DialOptions{
		HTTPHeader: upstreamHeaders,
		HTTPClient: proxyHTTPClient(state),
	})
	if err != nil {
		emitProxyRequestLog(state, "egress_proxy_upgrade_failed", map[string]any{
			"requestId": requestID,
			"routeMode": routeMode,
			"outcome":   "connect_failed",
			"error":     err.Error(),
		})
		return fmt.Errorf("websocket upstream connection failed: %w", err)
	}
	defer upstreamConnection.Close(websocket.StatusNormalClosure, "")

	responseWriter.Header().Set(SandboxEgressRequestIDHeaderName, requestID)
	downstreamConnection, err := websocket.Accept(responseWriter, request, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		emitProxyRequestLog(state, "egress_proxy_upgrade_failed", map[string]any{
			"requestId": requestID,
			"routeMode": routeMode,
			"outcome":   "downstream_upgrade_failed",
			"error":     err.Error(),
		})
		return fmt.Errorf("websocket downstream upgrade failed: %w", err)
	}
	defer downstreamConnection.Close(websocket.StatusNormalClosure, "")

	tunnelWebSockets(context.Background(), downstreamConnection, upstreamConnection)
	emitProxyRequestLog(state, "egress_proxy_upgrade_completed", map[string]any{
		"requestId": requestID,
		"routeMode": routeMode,
		"outcome":   "completed",
	})
	return nil
}

func HandleConnectRequest(responseWriter http.ResponseWriter, request *http.Request, state *ProxyState) error {
	if state == nil {
		return fmt.Errorf("local egress proxy state is required")
	}
	if state.ProxyCACertPEM == "" {
		return fmt.Errorf("proxy ca certificate pem is required for CONNECT")
	}
	if state.ProxyCAKeyPEM == "" {
		return fmt.Errorf("proxy ca private key pem is required for CONNECT")
	}
	authority := request.Host
	if authority == "" && request.URL != nil {
		authority = request.URL.Host
	}
	if authority == "" {
		return fmt.Errorf("CONNECT requests must include a target authority")
	}
	hijacker, ok := responseWriter.(http.Hijacker)
	if !ok {
		return fmt.Errorf("CONNECT response writer does not support hijacking")
	}
	connection, buffered, err := hijacker.Hijack()
	if err != nil {
		return fmt.Errorf("failed to hijack CONNECT connection: %w", err)
	}
	if buffered.Reader.Buffered() > 0 {
		connection.Close()
		return fmt.Errorf("CONNECT request had unexpected buffered payload")
	}
	if _, err := buffered.WriteString("HTTP/1.1 200 OK\r\n\r\n"); err != nil {
		connection.Close()
		return fmt.Errorf("failed to write CONNECT acknowledgement response: %w", err)
	}
	if err := buffered.Flush(); err != nil {
		connection.Close()
		return fmt.Errorf("failed to flush CONNECT acknowledgement response: %w", err)
	}

	tlsConfig, err := buildTLSInterceptConfig(authority, state)
	if err != nil {
		connection.Close()
		return err
	}
	tlsConnection := tls.Server(connection, tlsConfig)
	go serveConnectTLSConnection(tlsConnection, state, authority)
	return nil
}

func handleTransparentProxyConnection(connection net.Conn, originalDestination net.Addr, state *ProxyState) error {
	if connection == nil {
		return fmt.Errorf("transparent egress proxy connection is required")
	}
	if originalDestination == nil {
		return fmt.Errorf("transparent egress original destination is required")
	}
	if state == nil {
		return fmt.Errorf("transparent egress proxy state is required")
	}
	reader := bufio.NewReader(connection)
	firstByte, err := reader.Peek(1)
	if err != nil {
		if err == io.EOF {
			emitProxyRequestLog(state, "egress_proxy_transparent_connection_empty", map[string]any{
				"originalDestination": originalDestination.String(),
				"detectedProtocol":    "empty",
			})
			return nil
		}
		return fmt.Errorf("failed to inspect transparent egress proxy connection: %w", err)
	}
	bufferedConnection := &bufferedConn{Conn: connection, reader: reader}
	authority := originalDestination.String()
	protocol := ClassifyTransparentProxyFirstByte(firstByte[0])
	fields := map[string]any{
		"originalDestination": originalDestination.String(),
		"detectedProtocol":    transparentProxyProtocolName(protocol),
	}
	switch protocol {
	case TransparentProxyProtocolPlainHTTP:
		fields["scheme"] = "http"
		fields["authority"] = authority
		emitProxyRequestLog(state, "egress_proxy_transparent_connection_started", fields)
		return serveTransparentHTTPConnection(bufferedConnection, state, RequestTargetOverride{
			Scheme:           "http",
			DefaultAuthority: authority,
		})
	case TransparentProxyProtocolTLS:
		fields["scheme"] = "https"
		fields["authority"] = authority
		emitProxyRequestLog(state, "egress_proxy_transparent_connection_started", fields)
		tlsConnection := tls.Server(bufferedConnection, buildTransparentTLSInterceptConfig(authority, state))
		return serveTransparentHTTPConnection(tlsConnection, state, RequestTargetOverride{
			Scheme:           "https",
			DefaultAuthority: authority,
		})
	case TransparentProxyProtocolUnsupported:
		return proxyTransparentPassthrough(bufferedConnection, originalDestination, state, fields)
	default:
		return nil
	}
}

func transparentProxyProtocolName(protocol TransparentProxyProtocol) string {
	switch protocol {
	case TransparentProxyProtocolPlainHTTP:
		return "http"
	case TransparentProxyProtocolTLS:
		return "tls"
	case TransparentProxyProtocolUnsupported:
		return "unsupported"
	default:
		return "empty"
	}
}

func serveTransparentHTTPConnection(connection net.Conn, state *ProxyState, targetOverride RequestTargetOverride) error {
	server := &http.Server{
		Handler: ProxyHandler{
			State:          state,
			TargetOverride: &targetOverride,
		},
	}
	err := server.Serve(newSingleConnectionListener(connection))
	if err != nil && err != http.ErrServerClosed && !errorsIsClosedNetworkConnection(err) {
		return fmt.Errorf("transparent HTTP connection failed: %w", err)
	}
	return nil
}

func proxyTransparentPassthrough(downstream net.Conn, originalDestination net.Addr, state *ProxyState, fields map[string]any) error {
	emitProxyRequestLog(state, "egress_proxy_transparent_passthrough_started", cloneLogFields(fields))
	startedAt := timeNow()
	upstream, err := DialTransparentPassthrough(originalDestination)
	if err != nil {
		failedFields := cloneLogFields(fields)
		failedFields["outcome"] = "connect_failed"
		failedFields["error"] = err.Error()
		emitProxyRequestLog(state, "egress_proxy_transparent_passthrough_failed", failedFields)
		return err
	}
	defer upstream.Close()

	done := make(chan copyResult, 2)
	go copyAndClose(done, "request", upstream, downstream)
	go copyAndClose(done, "response", downstream, upstream)
	firstResult := <-done
	secondResult := <-done
	requestBytes := firstResult.bytes
	responseBytes := secondResult.bytes
	if firstResult.direction == "response" {
		requestBytes = secondResult.bytes
		responseBytes = firstResult.bytes
	}
	completedFields := cloneLogFields(fields)
	completedFields["outcome"] = "completed"
	completedFields["durationMs"] = time.Since(startedAt).Milliseconds()
	completedFields["requestBytes"] = requestBytes
	completedFields["responseBytes"] = responseBytes
	emitProxyRequestLog(state, "egress_proxy_transparent_passthrough_completed", completedFields)
	if firstResult.err != nil {
		return firstResult.err
	}
	return secondResult.err
}

func cloneLogFields(fields map[string]any) map[string]any {
	cloned := make(map[string]any, len(fields))
	for key, value := range fields {
		cloned[key] = value
	}
	return cloned
}

func forwardDirectRequest(request *http.Request, requestTarget RequestTarget, requestID string, state *ProxyState, targetOverride *RequestTargetOverride) (*http.Response, error) {
	outboundRequest, err := buildOutboundRequest(request, requestTarget.URL.String(), request.Body)
	if err != nil {
		return nil, err
	}
	outboundRequest.Header = filterOutboundRequestHeaders(request.Header)
	outboundRequest.Header.Set(SandboxEgressRequestIDHeaderName, requestID)
	response, err := directProxyHTTPClient(state, targetOverride).Do(outboundRequest)
	if err != nil {
		return nil, err
	}
	response.Header.Set(SandboxEgressRequestIDHeaderName, requestID)
	return response, nil
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
	outboundRequest.Header.Set(DirectGatewayEgressAuthorizationHeaderName, "Bearer "+token.Token)
	outboundRequest.Header.Set(SandboxEgressRequestIDHeaderName, requestID)
	response, err := proxyHTTPClient(state).Do(outboundRequest)
	if err != nil {
		return nil, err
	}
	response.Header.Set(SandboxEgressRequestIDHeaderName, requestID)
	return response, nil
}

func buildOutboundRequest(source *http.Request, targetURL string, body io.Reader) (*http.Request, error) {
	outboundRequest, err := http.NewRequestWithContext(source.Context(), source.Method, targetURL, body)
	if err != nil {
		return nil, fmt.Errorf("failed to build egress proxy upstream request: %w", err)
	}
	return outboundRequest, nil
}

func copyResponse(responseWriter http.ResponseWriter, response *http.Response) {
	connectionHeaderNames := headerConnectionTokens(response.Header)
	for name, values := range response.Header {
		if shouldSkipResponseHeader(name, connectionHeaderNames) {
			continue
		}
		for _, value := range values {
			responseWriter.Header().Add(name, value)
		}
	}
	responseWriter.WriteHeader(response.StatusCode)
	_, _ = io.Copy(responseWriter, response.Body)
}

func shouldSkipResponseHeader(name string, connectionHeaderNames map[string]struct{}) bool {
	if isHopByHopHeader(name) {
		return true
	}
	_, exists := connectionHeaderNames[http.CanonicalHeaderKey(name)]
	return exists
}

func headerConnectionTokens(headers http.Header) map[string]struct{} {
	tokens := map[string]struct{}{}
	for _, value := range headers.Values("Connection") {
		for _, token := range strings.Split(value, ",") {
			trimmed := strings.TrimSpace(token)
			if trimmed != "" {
				tokens[http.CanonicalHeaderKey(trimmed)] = struct{}{}
			}
		}
	}
	return tokens
}

func isHopByHopHeader(name string) bool {
	switch http.CanonicalHeaderKey(name) {
	case "Connection",
		"Keep-Alive",
		"Proxy-Authenticate",
		"Proxy-Authorization",
		"Te",
		"Trailer",
		"Transfer-Encoding",
		"Upgrade":
		return true
	default:
		return false
	}
}

func proxyHTTPClient(state *ProxyState) *http.Client {
	if state.HTTPClient != nil {
		return state.HTTPClient
	}
	state.httpClientOnce.Do(func() {
		state.httpClient = newDirectProxyHTTPClient()
	})
	return state.httpClient
}

func newDirectProxyHTTPClient() *http.Client {
	return &http.Client{Transport: http.DefaultTransport.(*http.Transport).Clone()}
}

func directProxyHTTPClient(state *ProxyState, targetOverride *RequestTargetOverride) *http.Client {
	if targetOverride == nil {
		return proxyHTTPClient(state)
	}
	if state.HTTPClient != nil {
		return state.HTTPClient
	}
	return &http.Client{Transport: NewTransparentPassthroughHTTPTransport()}
}

type loggingResponseBody struct {
	io.ReadCloser
	state           *ProxyState
	requestID       string
	routeMode       string
	upstreamStatus  int
	upstreamTraceID string
	startedAt       time.Time
	bytesRead       int64
	chunkCount      uint64
	sawFirst        bool
	finished        bool
}

func (body *loggingResponseBody) Read(payload []byte) (int, error) {
	n, err := body.ReadCloser.Read(payload)
	if n > 0 {
		body.bytesRead += int64(n)
		body.chunkCount++
		if !body.sawFirst {
			body.sawFirst = true
			fields := body.logFields("streaming")
			fields["firstChunkLatencyMs"] = time.Since(body.startedAt).Milliseconds()
			emitProxyRequestLog(body.state, "egress_proxy_response_body_first_chunk", fields)
		}
	}
	if err == io.EOF {
		body.recordCompleted()
	} else if err != nil {
		body.recordFailed(err)
	}
	return n, err
}

func (body *loggingResponseBody) Close() error {
	err := body.ReadCloser.Close()
	if err != nil {
		body.recordFailed(err)
		return err
	}
	if !body.finished {
		body.finished = true
		emitProxyRequestLog(body.state, "egress_proxy_response_body_cancelled", body.logFields("cancelled"))
	}
	return nil
}

func (body *loggingResponseBody) recordCompleted() {
	if body.finished {
		return
	}
	body.finished = true
	emitProxyRequestLog(body.state, "egress_proxy_response_body_completed", body.logFields("completed"))
}

func (body *loggingResponseBody) recordFailed(err error) {
	if body.finished {
		return
	}
	body.finished = true
	fields := body.logFields("upstream_error")
	fields["error"] = err.Error()
	emitProxyRequestLog(body.state, "egress_proxy_response_body_failed", fields)
}

func (body *loggingResponseBody) logFields(outcome string) map[string]any {
	fields := map[string]any{
		"requestId":      body.requestID,
		"routeMode":      body.routeMode,
		"upstreamStatus": body.upstreamStatus,
		"outcome":        outcome,
		"chunkCount":     body.chunkCount,
		"forwardedBytes": body.bytesRead,
		"bytesRead":      body.bytesRead,
	}
	if body.sawFirst {
		fields["firstChunkLatencyMs"] = time.Since(body.startedAt).Milliseconds()
	}
	if body.upstreamTraceID != "" {
		fields["upstreamTraceId"] = body.upstreamTraceID
	}
	return fields
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

func buildTLSInterceptConfig(authority string, state *ProxyState) (*tls.Config, error) {
	certificatePEM, privateKeyPEM, err := IssueProxyLeafCertificate(state.ProxyCACertPEM, state.ProxyCAKeyPEM, authority, timeNow())
	if err != nil {
		return nil, err
	}
	certificate, err := tls.X509KeyPair([]byte(certificatePEM), []byte(privateKeyPEM))
	if err != nil {
		return nil, fmt.Errorf("failed to build local egress proxy certificate chain: %w", err)
	}
	return &tls.Config{
		Certificates: []tls.Certificate{certificate},
		MinVersion:   tls.VersionTLS12,
	}, nil
}

func buildTransparentTLSInterceptConfig(fallbackAuthority string, state *ProxyState) *tls.Config {
	return &tls.Config{
		MinVersion: tls.VersionTLS12,
		GetConfigForClient: func(clientHello *tls.ClientHelloInfo) (*tls.Config, error) {
			authority := fallbackAuthority
			if clientHello.ServerName != "" {
				authority = clientHello.ServerName
			}
			return buildTLSInterceptConfig(authority, state)
		},
	}
}

func serveConnectTLSConnection(connection *tls.Conn, state *ProxyState, authority string) {
	if err := connection.Handshake(); err != nil {
		connection.Close()
		return
	}
	listener := newSingleConnectionListener(connection)
	server := &http.Server{
		Handler: ProxyHandler{
			State: state,
			TargetOverride: &RequestTargetOverride{
				Scheme:           "https",
				DefaultAuthority: authority,
			},
		},
	}
	_ = server.Serve(listener)
}

type singleConnectionListener struct {
	connection *singleConnection
	accepted   atomic.Bool
	closed     atomic.Bool
}

func newSingleConnectionListener(connection net.Conn) *singleConnectionListener {
	done := make(chan struct{})
	return &singleConnectionListener{
		connection: &singleConnection{
			Conn: connection,
			done: done,
		},
	}
}

func (listener *singleConnectionListener) Accept() (net.Conn, error) {
	if listener.accepted.CompareAndSwap(false, true) {
		return listener.connection, nil
	}
	<-listener.connection.done
	return nil, net.ErrClosed
}

func (listener *singleConnectionListener) Close() error {
	if listener.closed.CompareAndSwap(false, true) {
		return listener.connection.Close()
	}
	return nil
}

func (listener *singleConnectionListener) Addr() net.Addr {
	return listener.connection.LocalAddr()
}

type singleConnection struct {
	net.Conn
	done chan struct{}
	once atomic.Bool
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (connection *bufferedConn) Read(payload []byte) (int, error) {
	return connection.reader.Read(payload)
}

type copyResult struct {
	direction string
	bytes     int64
	err       error
}

func copyAndClose(done chan<- copyResult, direction string, destination net.Conn, source net.Conn) {
	bytes, err := io.Copy(destination, source)
	if tcpConnection, ok := destination.(*net.TCPConn); ok {
		_ = tcpConnection.CloseWrite()
	} else {
		_ = destination.Close()
	}
	done <- copyResult{direction: direction, bytes: bytes, err: err}
}

func errorsIsClosedNetworkConnection(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, net.ErrClosed) || strings.Contains(err.Error(), "use of closed network connection")
}

func (connection *singleConnection) Close() error {
	if connection.once.CompareAndSwap(false, true) {
		close(connection.done)
	}
	return connection.Conn.Close()
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
