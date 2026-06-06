package process

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/mistle/sandboxd/runtime"
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
