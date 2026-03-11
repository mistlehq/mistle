package proxy

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
)

type Handler struct {
	httpClient *http.Client
}

type NewHandlerInput struct {
	HTTPClient *http.Client
}

func NewHandler(input NewHandlerInput) (http.Handler, error) {
	if input.HTTPClient == nil {
		return nil, fmt.Errorf("http client is required")
	}

	return Handler{
		httpClient: input.HTTPClient,
	}, nil
}

func hopByHopHeaderNames(source http.Header, includeHost bool) map[string]struct{} {
	excludedHeaderNames := map[string]struct{}{
		"connection":          {},
		"keep-alive":          {},
		"proxy-authenticate":  {},
		"proxy-authorization": {},
		"proxy-connection":    {},
		"te":                  {},
		"trailer":             {},
		"transfer-encoding":   {},
		"upgrade":             {},
	}
	if includeHost {
		excludedHeaderNames["host"] = struct{}{}
	}

	for _, connectionValue := range source.Values("Connection") {
		for _, token := range strings.Split(connectionValue, ",") {
			normalizedToken := strings.ToLower(strings.TrimSpace(token))
			if normalizedToken == "" {
				continue
			}
			excludedHeaderNames[normalizedToken] = struct{}{}
		}
	}

	return excludedHeaderNames
}

func copyHeadersWithoutHopByHop(target http.Header, source http.Header, includeHost bool) {
	excludedHeaderNames := hopByHopHeaderNames(source, includeHost)

	for headerName, values := range source {
		if _, excluded := excludedHeaderNames[strings.ToLower(headerName)]; excluded {
			continue
		}

		for _, value := range values {
			target.Add(headerName, value)
		}
	}
}

func normalizeConnectTarget(connectTarget string) string {
	if strings.Contains(connectTarget, ":") {
		return connectTarget
	}

	return net.JoinHostPort(connectTarget, "443")
}

func writeConnectSuccess(conn net.Conn) error {
	_, err := io.WriteString(conn, "HTTP/1.1 200 Connection Established\r\n\r\n")
	return err
}

func relayConnection(dst net.Conn, src net.Conn, bufferedReader *bufio.Reader, errCh chan<- error) {
	if bufferedReader != nil && bufferedReader.Buffered() > 0 {
		if _, err := io.Copy(dst, bufferedReader); err != nil {
			errCh <- err
			return
		}
	}

	_, err := io.Copy(dst, src)
	errCh <- err
}

func (handler Handler) handleConnect(writer http.ResponseWriter, request *http.Request) {
	hijacker, ok := writer.(http.Hijacker)
	if !ok {
		http.Error(writer, "proxy hijacking is not supported", http.StatusInternalServerError)
		return
	}

	clientConn, clientBuffer, err := hijacker.Hijack()
	if err != nil {
		http.Error(writer, fmt.Sprintf("failed to hijack proxy connection: %v", err), http.StatusBadGateway)
		return
	}
	defer clientConn.Close()

	upstreamTarget := normalizeConnectTarget(request.Host)
	upstreamConn, err := (&net.Dialer{}).DialContext(request.Context(), "tcp", upstreamTarget)
	if err != nil {
		_, _ = io.WriteString(clientConn, "HTTP/1.1 502 Bad Gateway\r\n\r\n")
		return
	}
	defer upstreamConn.Close()

	if err := writeConnectSuccess(clientConn); err != nil {
		return
	}

	relayErrCh := make(chan error, 2)
	go relayConnection(upstreamConn, clientConn, clientBuffer.Reader, relayErrCh)
	go relayConnection(clientConn, upstreamConn, nil, relayErrCh)

	<-relayErrCh
}

func (handler Handler) handleForward(writer http.ResponseWriter, request *http.Request) {
	if request.URL == nil || request.URL.Scheme == "" || request.URL.Host == "" {
		http.Error(writer, "proxy requests must use an absolute URL", http.StatusBadRequest)
		return
	}
	if !strings.EqualFold(request.URL.Scheme, "http") {
		http.Error(writer, "https proxy requests must use CONNECT", http.StatusBadRequest)
		return
	}

	forwardRequest, err := http.NewRequestWithContext(
		request.Context(),
		request.Method,
		request.URL.String(),
		request.Body,
	)
	if err != nil {
		http.Error(writer, fmt.Sprintf("failed to create upstream request: %v", err), http.StatusBadGateway)
		return
	}

	copyHeadersWithoutHopByHop(forwardRequest.Header, request.Header, true)
	forwardRequest.Host = request.URL.Host

	response, err := handler.httpClient.Do(forwardRequest)
	if err != nil {
		http.Error(writer, fmt.Sprintf("failed to forward proxy request: %v", err), http.StatusBadGateway)
		return
	}
	defer response.Body.Close()

	copyHeadersWithoutHopByHop(writer.Header(), response.Header, false)
	writer.WriteHeader(response.StatusCode)
	_, _ = io.Copy(writer, response.Body)
}

func (handler Handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.Method == http.MethodConnect {
		handler.handleConnect(writer, request)
		return
	}

	handler.handleForward(writer, request)
}
