package tunnel

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"

	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

var hopByHopResponseHeaders = map[string]struct{}{
	"connection":          {},
	"keep-alive":          {},
	"proxy-authenticate":  {},
	"proxy-authorization": {},
	"te":                  {},
	"trailer":             {},
	"transfer-encoding":   {},
	"upgrade":             {},
}

func (session *LiveTunnelSession) openPortAccessHTTPStream(ctx context.Context, message tunnelprotocol.PortsHTTPOpen) error {
	if session.streamActive(message.StreamID) {
		return fmt.Errorf("ports.http.open streamId %d already exists", message.StreamID)
	}
	requestBodyReader, requestBodyWriter := io.Pipe()
	bodyReader := io.Reader(requestBodyReader)
	if requestHasNoBody(message.Request.Method) {
		bodyReader = nil
		_ = requestBodyWriter.Close()
		requestBodyWriter = nil
	}
	streamCtx, cancel := context.WithCancel(context.Background())
	session.mutex.Lock()
	session.streams[message.StreamID] = &liveTunnelStream{
		kind:           "portAccessHTTP",
		cancel:         cancel,
		httpBodyWriter: requestBodyWriter,
	}
	session.mutex.Unlock()
	go session.runPortAccessHTTPStream(streamCtx, message, requestBodyReader, bodyReader)
	return nil
}

func (session *LiveTunnelSession) runPortAccessHTTPStream(ctx context.Context, message tunnelprotocol.PortsHTTPOpen, requestBodyReader *io.PipeReader, bodyReader io.Reader) {
	defer requestBodyReader.Close()
	request, err := buildPortAccessHTTPRequest(ctx, message, bodyReader)
	if err != nil {
		session.publishPortAccessHTTPError(message.StreamID, "upstream_handshake_failed", err.Error())
		return
	}
	response, err := portAccessHTTPClient().Do(request)
	if err != nil {
		session.publishPortAccessHTTPError(message.StreamID, classifyPortAccessHTTPOpenError(err), err.Error())
		return
	}
	defer response.Body.Close()

	responseStart, responseStartErr := tunnelprotocol.PortsHTTPResponseStartPayload(tunnelprotocol.PortsHTTPResponseStart{
		StreamID: message.StreamID,
		Status:   response.StatusCode,
		Headers:  portAccessResponseHeaders(response.Header),
	})
	if err := session.writeControl(context.Background(), responseStart, responseStartErr); err != nil {
		session.closeStream(message.StreamID)
		return
	}
	buffer := make([]byte, 16*1024)
	for {
		bytesRead, err := response.Body.Read(buffer)
		if bytesRead > 0 {
			chunk, chunkErr := tunnelprotocol.PortsHTTPBodyChunkPayload(
				message.StreamID,
				"response",
				base64.StdEncoding.EncodeToString(buffer[:bytesRead]),
			)
			if writeErr := session.writeControl(context.Background(), chunk, chunkErr); writeErr != nil {
				session.closeStream(message.StreamID)
				return
			}
		}
		if err == io.EOF {
			bodyEnd, bodyEndErr := tunnelprotocol.PortsHTTPBodyEndPayload(message.StreamID, "response")
			_ = session.writeControl(context.Background(), bodyEnd, bodyEndErr)
			session.removeStream(message.StreamID)
			return
		}
		if err != nil {
			session.publishPortAccessHTTPError(message.StreamID, "upstream_io_error", err.Error())
			return
		}
	}
}

func (session *LiveTunnelSession) handlePortAccessHTTPBodyChunk(message tunnelprotocol.PortsHTTPBodyChunk) error {
	if message.Direction != "request" {
		return fmt.Errorf("ports.http.body.chunk streamId %d must use request direction when sent to sandboxd", message.StreamID)
	}
	stream := session.stream(message.StreamID)
	if stream == nil || stream.kind != "portAccessHTTP" || stream.httpBodyWriter == nil {
		return fmt.Errorf("ports.http.body.chunk streamId %d is not bound to an active port access http stream", message.StreamID)
	}
	bytes, err := base64.StdEncoding.DecodeString(message.Bytes)
	if err != nil {
		return err
	}
	_, err = stream.httpBodyWriter.Write(bytes)
	return err
}

func (session *LiveTunnelSession) handlePortAccessHTTPBodyEnd(message tunnelprotocol.PortsHTTPBodyEnd) error {
	if message.Direction != "request" {
		return fmt.Errorf("ports.http.body.end streamId %d must use request direction when sent to sandboxd", message.StreamID)
	}
	stream := session.stream(message.StreamID)
	if stream == nil || stream.kind != "portAccessHTTP" || stream.httpBodyWriter == nil {
		return fmt.Errorf("ports.http.body.end streamId %d is not bound to an active port access http stream", message.StreamID)
	}
	return stream.httpBodyWriter.Close()
}

func (session *LiveTunnelSession) closePortAccessStream(message tunnelprotocol.PortsStreamClose) error {
	stream := session.stream(message.StreamID)
	if stream == nil || stream.kind != "portAccessHTTP" {
		return fmt.Errorf("ports.stream.close streamId %d is not bound to an active port access transport stream", message.StreamID)
	}
	session.closeStream(message.StreamID)
	return nil
}

func (session *LiveTunnelSession) publishPortAccessHTTPError(streamID uint32, code string, message string) {
	payload, payloadErr := tunnelprotocol.PortsStreamErrorPayload(streamID, code, message)
	_ = session.writeControl(context.Background(), payload, payloadErr)
	session.closeStream(streamID)
}

func buildPortAccessHTTPRequest(ctx context.Context, message tunnelprotocol.PortsHTTPOpen, body io.Reader) (*http.Request, error) {
	requestURL, err := portAccessRequestURL(message)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, message.Request.Method, requestURL, body)
	if err != nil {
		return nil, err
	}
	for headerName, values := range message.Request.Headers {
		for _, value := range values {
			request.Header.Add(headerName, value)
		}
	}
	request.Host = loopbackHostHeader("localhost", message.Target.Port)
	return request, nil
}

func portAccessRequestURL(message tunnelprotocol.PortsHTTPOpen) (string, error) {
	path := message.Request.Path
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	parsedURL := url.URL{
		Scheme: message.UpstreamProtocol,
		Host:   loopbackHostHeader("localhost", message.Target.Port),
		Path:   path,
	}
	if message.Request.Query != nil {
		parsedURL.RawQuery = *message.Request.Query
	}
	return parsedURL.String(), nil
}

func portAccessHTTPClient() *http.Client {
	dialer := net.Dialer{}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network string, address string) (net.Conn, error) {
			connection, err := dialer.DialContext(ctx, network, address)
			if err != nil {
				return nil, portAccessHTTPConnectError{err: err}
			}
			return connection, nil
		},
		TLSClientConfig: &tls.Config{
			ServerName:         "localhost",
			InsecureSkipVerify: true,
		},
	}
	return &http.Client{Transport: transport}
}

type portAccessHTTPConnectError struct {
	err error
}

func (err portAccessHTTPConnectError) Error() string {
	return err.err.Error()
}

func (err portAccessHTTPConnectError) Unwrap() error {
	return err.err
}

func classifyPortAccessHTTPOpenError(err error) string {
	var connectErr portAccessHTTPConnectError
	if errors.As(err, &connectErr) {
		return "upstream_connect_failed"
	}
	return "upstream_handshake_failed"
}

func portAccessResponseHeaders(headers http.Header) tunnelprotocol.RepeatedHeaderValues {
	result := tunnelprotocol.RepeatedHeaderValues{}
	for headerName, values := range headers {
		if _, skip := hopByHopResponseHeaders[strings.ToLower(headerName)]; skip {
			continue
		}
		copiedValues := make([]string, len(values))
		copy(copiedValues, values)
		result[headerName] = copiedValues
	}
	return result
}

func requestHasNoBody(method string) bool {
	normalized := strings.ToUpper(method)
	return normalized == http.MethodGet || normalized == http.MethodHead
}
