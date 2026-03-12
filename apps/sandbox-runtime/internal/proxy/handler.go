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
	integrationMediator  IntegrationMediator
}

type NewHandlerInput struct {
	HTTPClient           *http.Client
	CertificateAuthority *CertificateAuthority
	IntegrationMediator  IntegrationMediator
}

type RequestClassification struct {
	Host   string
	Method string
	Path   string
}

type IntegrationMediator interface {
	ForwardIfMatch(
		request *http.Request,
		classification RequestClassification,
	) (*http.Response, bool, error)
}

type bufferedConn struct {
	net.Conn
	reader io.Reader
}

func (conn *bufferedConn) Read(buffer []byte) (int, error) {
	return conn.reader.Read(buffer)
}

type readWriteCloser interface {
	io.Reader
	io.Writer
	io.Closer
}

func NewHandler(input NewHandlerInput) (http.Handler, error) {
	if input.HTTPClient == nil {
		return nil, fmt.Errorf("http client is required")
	}

	return Handler{
		httpClient:           newRedirectPreservingClient(input.HTTPClient),
		certificateAuthority: input.CertificateAuthority,
		integrationMediator:  input.IntegrationMediator,
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

func relayStream(dst io.Writer, src io.Reader, errCh chan<- error) {
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

		if response.StatusCode == http.StatusSwitchingProtocols {
			if writeErr := writeProxySwitchingProtocolsResponse(tlsConn, response); writeErr != nil {
				closeResponseBody(response)
				return
			}

			upgradedBody, ok := response.Body.(readWriteCloser)
			if !ok {
				closeResponseBody(response)
				return
			}

			relayErrCh := make(chan error, 2)
			go relayStream(upgradedBody, tlsReader, relayErrCh)
			go relayStream(tlsConn, upgradedBody, relayErrCh)
			<-relayErrCh
			closeResponseBody(response)
			return
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
	if handler.integrationMediator != nil {
		response, matched, mediationErr := handler.integrationMediator.ForwardIfMatch(
			request,
			classification.RequestClassification,
		)
		if mediationErr != nil {
			return nil, mediationErr
		}
		if matched {
			return filterProxyResponse(response), nil
		}
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
	restoreUpgradeHeaders(forwardRequest.Header, request.Header)
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

	classification, err := classifyForwardRequest(request)
	if err != nil {
		http.Error(writer, fmt.Sprintf("failed to classify proxy request: %v", err), http.StatusBadRequest)
		return
	}
	if handler.integrationMediator != nil {
		response, matched, mediationErr := handler.integrationMediator.ForwardIfMatch(
			request,
			classification.RequestClassification,
		)
		if mediationErr != nil {
			http.Error(
				writer,
				fmt.Sprintf("failed to mediate integration proxy request: %v", mediationErr),
				http.StatusBadGateway,
			)
			return
		}
		if matched {
			filteredResponse := filterProxyResponse(response)
			defer filteredResponse.Body.Close()

			copyHeadersWithoutHopByHop(writer.Header(), filteredResponse.Header, false)
			restoreUpgradeHeaders(writer.Header(), filteredResponse.Header)
			writer.WriteHeader(filteredResponse.StatusCode)
			_, _ = io.Copy(writer, filteredResponse.Body)
			return
		}
	}

	forwardRequest, err := http.NewRequestWithContext(
		request.Context(),
		classification.Method,
		classification.UpstreamURL.String(),
		request.Body,
	)
	if err != nil {
		http.Error(writer, fmt.Sprintf("failed to create upstream request: %v", err), http.StatusBadGateway)
		return
	}

	copyHeadersWithoutHopByHop(forwardRequest.Header, request.Header, true)
	forwardRequest.Host = classification.UpstreamHost

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

func classifyForwardRequest(request *http.Request) (interceptedRequestClassification, error) {
	if request.URL == nil {
		return interceptedRequestClassification{}, fmt.Errorf("http proxy request url is required")
	}
	if !request.URL.IsAbs() {
		return interceptedRequestClassification{}, fmt.Errorf("http proxy request must use an absolute url")
	}

	upstreamURL := *request.URL
	return interceptedRequestClassification{
		RequestClassification: RequestClassification{
			Host:   normalizeCertificateHost(upstreamURL.Host),
			Method: request.Method,
			Path:   normalizeForwardPath(upstreamURL.Path),
		},
		UpstreamURL:  &upstreamURL,
		UpstreamHost: firstNonEmpty(request.Host, upstreamURL.Host),
	}, nil
}

func normalizeForwardPath(path string) string {
	if path == "" {
		return "/"
	}
	if strings.HasPrefix(path, "/") {
		return path
	}

	return "/" + path
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
		StatusCode:       response.StatusCode,
		Status:           response.Status,
		Proto:            response.Proto,
		ProtoMajor:       response.ProtoMajor,
		ProtoMinor:       response.ProtoMinor,
		Header:           make(http.Header),
		Body:             response.Body,
		ContentLength:    response.ContentLength,
		TransferEncoding: response.TransferEncoding,
		Close:            response.Close,
		Trailer:          make(http.Header),
		Uncompressed:     response.Uncompressed,
	}

	copyHeadersWithoutHopByHop(filteredResponse.Header, response.Header, false)
	copyHeadersWithoutHopByHop(filteredResponse.Trailer, response.Trailer, false)
	restoreUpgradeHeaders(filteredResponse.Header, response.Header)

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

func writeProxySwitchingProtocolsResponse(writer io.Writer, response *http.Response) error {
	bufferedWriter := bufio.NewWriter(writer)
	if _, err := fmt.Fprintf(bufferedWriter, "HTTP/%d.%d %s\r\n", response.ProtoMajor, response.ProtoMinor, response.Status); err != nil {
		return err
	}
	if err := response.Header.Write(bufferedWriter); err != nil {
		return err
	}
	if _, err := bufferedWriter.WriteString("\r\n"); err != nil {
		return err
	}
	return bufferedWriter.Flush()
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

func newRedirectPreservingClient(baseClient *http.Client) *http.Client {
	clonedClient := *baseClient
	clonedClient.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &clonedClient
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func isUpgradeHeaders(header http.Header) bool {
	if header == nil {
		return false
	}
	if strings.TrimSpace(header.Get("Upgrade")) == "" {
		return false
	}

	for _, connectionValue := range header.Values("Connection") {
		for _, token := range strings.Split(connectionValue, ",") {
			if strings.EqualFold(strings.TrimSpace(token), "upgrade") {
				return true
			}
		}
	}

	return false
}

func restoreUpgradeHeaders(target http.Header, source http.Header) {
	if !isUpgradeHeaders(source) {
		return
	}

	target.Del("Connection")
	target.Del("Upgrade")
	for _, value := range source.Values("Connection") {
		target.Add("Connection", value)
	}
	for _, value := range source.Values("Upgrade") {
		target.Add("Upgrade", value)
	}
}
