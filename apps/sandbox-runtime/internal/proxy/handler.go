package proxy

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
)

type Handler struct {
	httpClient           *http.Client
	certificateAuthority *CertificateAuthority
}

type NewHandlerInput struct {
	HTTPClient           *http.Client
	CertificateAuthority *CertificateAuthority
}

type RequestClassification struct {
	Host   string
	Method string
	Path   string
}

type bufferedConn struct {
	net.Conn
	reader io.Reader
}

func (conn *bufferedConn) Read(buffer []byte) (int, error) {
	return conn.reader.Read(buffer)
}

func NewHandler(input NewHandlerInput) (http.Handler, error) {
	if input.HTTPClient == nil {
		return nil, fmt.Errorf("http client is required")
	}

	return Handler{
		httpClient:           input.HTTPClient,
		certificateAuthority: input.CertificateAuthority,
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

	if handler.certificateAuthority == nil {
		_, _ = io.WriteString(clientConn, "HTTP/1.1 502 Bad Gateway\r\n\r\n")
		return
	}

	if err := writeConnectSuccess(clientConn); err != nil {
		return
	}

	connectTarget := normalizeConnectTarget(request.Host)
	serverTLSConfig := handler.certificateAuthority.TLSConfig(connectTarget)
	tlsConn := tls.Server(
		&bufferedConn{
			Conn:   clientConn,
			reader: io.MultiReader(clientBuffer.Reader, clientConn),
		},
		serverTLSConfig,
	)
	defer tlsConn.Close()

	if err := tlsConn.Handshake(); err != nil {
		return
	}

	tlsReader := bufio.NewReader(tlsConn)
	for {
		interceptedRequest, err := http.ReadRequest(tlsReader)
		if err != nil {
			if err == io.EOF {
				return
			}
			return
		}

		response, responseErr := handler.handleInterceptedHTTPSRequest(request.Context(), connectTarget, interceptedRequest)
		if responseErr != nil {
			response = newProxyErrorResponse(http.StatusBadGateway, fmt.Sprintf("failed to forward https proxy request: %v", responseErr))
		}

		if writeErr := writeProxyResponse(tlsConn, response); writeErr != nil {
			closeResponseBody(response)
			return
		}
		closeResponseBody(response)
		closeRequestBody(interceptedRequest)

		if interceptedRequest.Close || response.Close {
			return
		}
	}
}

func (handler Handler) handleInterceptedHTTPSRequest(
	context context.Context,
	connectTarget string,
	request *http.Request,
) (*http.Response, error) {
	classification, err := classifyInterceptedRequest(connectTarget, request)
	if err != nil {
		return nil, err
	}

	forwardRequest, err := http.NewRequestWithContext(
		context,
		request.Method,
		classification.UpstreamURL.String(),
		request.Body,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create upstream https request: %w", err)
	}

	copyHeadersWithoutHopByHop(forwardRequest.Header, request.Header, true)
	forwardRequest.Host = classification.UpstreamHost

	response, err := handler.httpClient.Do(forwardRequest)
	if err != nil {
		return nil, err
	}

	return filterProxyResponse(response), nil
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

type interceptedRequestClassification struct {
	RequestClassification
	UpstreamURL  *url.URL
	UpstreamHost string
}

func classifyInterceptedRequest(connectTarget string, request *http.Request) (interceptedRequestClassification, error) {
	if request.URL == nil {
		return interceptedRequestClassification{}, fmt.Errorf("https proxy request url is required")
	}
	if request.URL.IsAbs() {
		return interceptedRequestClassification{}, fmt.Errorf("https proxy request must use origin-form paths")
	}

	connectHost := normalizeCertificateHost(connectTarget)
	requestHost := normalizeCertificateHost(request.Host)
	if requestHost != "" && requestHost != connectHost {
		return interceptedRequestClassification{}, fmt.Errorf(
			"https proxy request host %q does not match connect target %q",
			request.Host,
			connectTarget,
		)
	}

	upstreamURL := &url.URL{
		Scheme:   "https",
		Host:     normalizeConnectTarget(connectTarget),
		Path:     request.URL.Path,
		RawPath:  request.URL.RawPath,
		RawQuery: request.URL.RawQuery,
	}

	return interceptedRequestClassification{
		RequestClassification: RequestClassification{
			Host:   connectHost,
			Method: request.Method,
			Path:   request.URL.Path,
		},
		UpstreamURL:  upstreamURL,
		UpstreamHost: firstNonEmpty(request.Host, normalizeConnectTarget(connectTarget)),
	}, nil
}

func filterProxyResponse(response *http.Response) *http.Response {
	filteredResponse := &http.Response{
		StatusCode:        response.StatusCode,
		Status:            response.Status,
		Proto:             response.Proto,
		ProtoMajor:        response.ProtoMajor,
		ProtoMinor:        response.ProtoMinor,
		Header:            make(http.Header),
		Body:              response.Body,
		ContentLength:     response.ContentLength,
		TransferEncoding:  response.TransferEncoding,
		Close:             response.Close,
		Trailer:           make(http.Header),
		Uncompressed:      response.Uncompressed,
	}

	copyHeadersWithoutHopByHop(filteredResponse.Header, response.Header, false)
	copyHeadersWithoutHopByHop(filteredResponse.Trailer, response.Trailer, false)

	return filteredResponse
}

func newProxyErrorResponse(statusCode int, message string) *http.Response {
	body := io.NopCloser(strings.NewReader(message))
	return &http.Response{
		StatusCode:    statusCode,
		Status:        fmt.Sprintf("%d %s", statusCode, http.StatusText(statusCode)),
		Proto:         "HTTP/1.1",
		ProtoMajor:    1,
		ProtoMinor:    1,
		Header:        http.Header{"Content-Type": []string{"text/plain; charset=utf-8"}},
		Body:          body,
		ContentLength: int64(len(message)),
		Close:         true,
	}
}

func writeProxyResponse(writer io.Writer, response *http.Response) error {
	return response.Write(writer)
}

func closeResponseBody(response *http.Response) {
	if response == nil || response.Body == nil {
		return
	}
	_ = response.Body.Close()
}

func closeRequestBody(request *http.Request) {
	if request == nil || request.Body == nil {
		return
	}
	_ = request.Body.Close()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
