package runtime

import (
	"fmt"
	"net"
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
