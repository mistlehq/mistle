package runtime

import (
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
)

func parseListenAddr(listenAddr string) (string, error) {
	normalizedListenAddr := listenAddr
	if strings.HasPrefix(listenAddr, ":") {
		normalizedListenAddr = "0.0.0.0" + listenAddr
	}

	if _, err := net.ResolveTCPAddr("tcp", normalizedListenAddr); err != nil {
		return "", fmt.Errorf(
			"%s must be a valid socket address, got %s: %w",
			config.ListenAddrEnv,
			listenAddr,
			err,
		)
	}

	return normalizedListenAddr, nil
}

// resolveLoopbackEgressBaseURL returns the sandboxd egress base URL as seen from
// inside the sandbox itself. Workspace source realization runs before any runtime
// clients start, so startup work has to call sandboxd over loopback instead of
// relying on external service discovery or the configured listen host.
func resolveLoopbackEgressBaseURL(listenAddr string) (string, error) {
	parsedListenAddr, err := parseListenAddr(listenAddr)
	if err != nil {
		return "", err
	}

	_, port, err := net.SplitHostPort(parsedListenAddr)
	if err != nil {
		return "", fmt.Errorf(
			"%s must include a host and port, got %s: %w",
			config.ListenAddrEnv,
			listenAddr,
			err,
		)
	}

	egressBaseURL := &url.URL{
		Scheme: "http",
		Host:   net.JoinHostPort("127.0.0.1", port),
		Path:   "/egress",
	}

	return egressBaseURL.String(), nil
}
