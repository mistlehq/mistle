package process

import (
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/mistle/sandboxd/runtime"
)

const (
	DefaultProcessReadinessProbeTimeout     = 250 * time.Millisecond
	CodexAppServerPostStartReadinessTimeout = 1000 * time.Millisecond
	readinessWebSocketKey                   = "c2FuZGJveGQtcHJvY2Vzcw=="
)

type ParsedReadinessURL struct {
	Scheme string
	Host   string
	Port   uint16
	Path   string
}

func ParseReadinessURL(rawURL string) (ParsedReadinessURL, error) {
	scheme, rest, ok := strings.Cut(rawURL, "://")
	if !ok {
		return ParsedReadinessURL{}, fmt.Errorf("readiness url %q is missing a scheme", rawURL)
	}
	authority, pathSuffix, hasPath := strings.Cut(rest, "/")
	path := "/"
	if hasPath {
		path = "/" + pathSuffix
	}
	if authority == "" {
		return ParsedReadinessURL{}, fmt.Errorf("readiness url %q is missing a host", rawURL)
	}

	defaultPort, err := defaultReadinessPort(scheme)
	if err != nil {
		return ParsedReadinessURL{}, err
	}
	host := authority
	port := defaultPort
	if parsedHost, parsedPort, found := strings.Cut(authority, ":"); found && !strings.Contains(parsedHost, "]") {
		portValue, err := strconv.ParseUint(parsedPort, 10, 16)
		if err != nil {
			return ParsedReadinessURL{}, fmt.Errorf("invalid readiness port in %q: %w", rawURL, err)
		}
		host = parsedHost
		port = uint16(portValue)
	}

	return ParsedReadinessURL{
		Scheme: scheme,
		Host:   host,
		Port:   port,
		Path:   path,
	}, nil
}

func CodexAppServerReadyzURL(readinessURL string) (string, error) {
	parsedURL, err := ParseReadinessURL(readinessURL)
	if err != nil {
		return "", err
	}
	switch parsedURL.Scheme {
	case "ws", "http":
		return fmt.Sprintf("http://%s:%d/readyz", parsedURL.Host, parsedURL.Port), nil
	default:
		return "", fmt.Errorf("unsupported Codex app-server readiness scheme %q", parsedURL.Scheme)
	}
}

func CheckRuntimeClientProcessReadinessFromSpec(processSpec RuntimeClientProcessSpec) error {
	switch processSpec.Readiness.Type {
	case runtime.RuntimeClientProcessReadinessNone:
		return nil
	case runtime.RuntimeClientProcessReadinessTCP:
		return CheckTCPReadiness(processSpec.Readiness.Host, processSpec.Readiness.Port)
	case runtime.RuntimeClientProcessReadinessHTTP:
		return CheckHTTPReadiness(processSpec.Readiness.URL, processSpec.Readiness.ExpectedStatus)
	case runtime.RuntimeClientProcessReadinessWS:
		return CheckWSReadiness(processSpec.Readiness.URL)
	default:
		return fmt.Errorf("unsupported readiness type: %s", processSpec.Readiness.Type)
	}
}

func CheckCodexAppServerPostStartReadiness(processSpec RuntimeClientProcessSpec) error {
	if processSpec.Readiness.Type == runtime.RuntimeClientProcessReadinessWS {
		readyzURL, err := CodexAppServerReadyzURL(processSpec.Readiness.URL)
		if err != nil {
			return err
		}
		return CheckHTTPReadinessWithTimeout(readyzURL, 200, CodexAppServerPostStartReadinessTimeout)
	}
	return CheckRuntimeClientProcessReadinessFromSpec(processSpec)
}

func CheckTCPReadiness(host string, port uint16) error {
	address := net.JoinHostPort(host, fmt.Sprint(port))
	connection, err := net.DialTimeout("tcp", address, DefaultProcessReadinessProbeTimeout)
	if err != nil {
		return fmt.Errorf("tcp readiness failed: %w", err)
	}
	if err := connection.Close(); err != nil {
		return fmt.Errorf("tcp readiness close failed: %w", err)
	}
	return nil
}

func CheckHTTPReadiness(rawURL string, expectedStatus uint16) error {
	return CheckHTTPReadinessWithTimeout(rawURL, expectedStatus, DefaultProcessReadinessProbeTimeout)
}

func CheckHTTPReadinessWithTimeout(rawURL string, expectedStatus uint16, timeout time.Duration) error {
	status, err := ReadinessProbeRequest(rawURL, nil, timeout)
	if err != nil {
		return err
	}
	if status != expectedStatus {
		return fmt.Errorf("http readiness returned status %d, expected %d", status, expectedStatus)
	}
	return nil
}

func CheckWSReadiness(rawURL string) error {
	expectedUpgrade := "websocket"
	status, err := ReadinessProbeRequest(rawURL, &expectedUpgrade, DefaultProcessReadinessProbeTimeout)
	if err != nil {
		return err
	}
	if status != 101 {
		return fmt.Errorf("websocket readiness returned status %d, expected 101", status)
	}
	return nil
}

func ReadinessProbeRequest(rawURL string, expectedUpgrade *string, timeout time.Duration) (uint16, error) {
	parsedURL, err := ParseReadinessURL(rawURL)
	if err != nil {
		return 0, err
	}
	if parsedURL.Scheme == "https" || parsedURL.Scheme == "wss" {
		return 0, fmt.Errorf("readiness url scheme %q is not supported yet", parsedURL.Scheme)
	}

	address := net.JoinHostPort(parsedURL.Host, fmt.Sprint(parsedURL.Port))
	connection, err := net.DialTimeout("tcp", address, timeout)
	if err != nil {
		return 0, fmt.Errorf("readiness request failed: %w", err)
	}
	defer connection.Close()
	if err := connection.SetDeadline(time.Now().Add(timeout)); err != nil {
		return 0, fmt.Errorf("failed to configure readiness request timeout: %w", err)
	}

	request := "GET " + parsedURL.Path + " HTTP/1.1\r\nHost: " + parsedURL.Host + "\r\n"
	if expectedUpgrade != nil {
		request += "Connection: Upgrade\r\n"
		request += "Upgrade: " + *expectedUpgrade + "\r\n"
		request += "Sec-WebSocket-Key: " + readinessWebSocketKey + "\r\n"
		request += "Sec-WebSocket-Version: 13\r\n"
	} else {
		request += "Connection: close\r\n"
	}
	request += "\r\n"

	if _, err := connection.Write([]byte(request)); err != nil {
		return 0, fmt.Errorf("failed to write readiness request: %w", err)
	}
	responseBytes := make([]byte, 1024)
	byteCount, err := connection.Read(responseBytes)
	if err != nil && err != io.EOF {
		return 0, fmt.Errorf("failed to read readiness response: %w", err)
	}
	response := string(responseBytes[:byteCount])
	return ParseHTTPStatus(response)
}

func ParseHTTPStatus(response string) (uint16, error) {
	statusLine, _, _ := strings.Cut(response, "\n")
	if statusLine == "" {
		return 0, fmt.Errorf("readiness response was empty")
	}
	parts := strings.Fields(statusLine)
	if len(parts) < 2 {
		return 0, fmt.Errorf("readiness response status line was incomplete")
	}
	status, err := strconv.ParseUint(parts[1], 10, 16)
	if err != nil {
		return 0, fmt.Errorf("readiness response status was invalid: %w", err)
	}
	return uint16(status), nil
}

func ReadinessType(processSpec RuntimeClientProcessSpec) string {
	return string(processSpec.Readiness.Type)
}

func ReadinessTarget(processSpec RuntimeClientProcessSpec) string {
	switch processSpec.Readiness.Type {
	case runtime.RuntimeClientProcessReadinessNone:
		return ""
	case runtime.RuntimeClientProcessReadinessTCP:
		return fmt.Sprintf("%s:%d", processSpec.Readiness.Host, processSpec.Readiness.Port)
	case runtime.RuntimeClientProcessReadinessHTTP, runtime.RuntimeClientProcessReadinessWS:
		return processSpec.Readiness.URL
	default:
		return string(processSpec.Readiness.Type)
	}
}

func ReadinessTimeoutMS(processSpec RuntimeClientProcessSpec) uint64 {
	if processSpec.Readiness.Type == runtime.RuntimeClientProcessReadinessNone {
		return 0
	}
	return processSpec.Readiness.TimeoutMS
}

func defaultReadinessPort(scheme string) (uint16, error) {
	switch scheme {
	case "http", "ws":
		return 80, nil
	case "https", "wss":
		return 443, nil
	default:
		return 0, fmt.Errorf("readiness url scheme %q is not supported", scheme)
	}
}
