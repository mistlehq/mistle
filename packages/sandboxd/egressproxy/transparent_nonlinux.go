//go:build !linux

package egressproxy

import (
	"fmt"
	"net"
	"net/http"
)

func RecoverOriginalDestination(_ net.Conn) (net.Addr, error) {
	return nil, fmt.Errorf("transparent egress original destination lookup requires Linux SO_ORIGINAL_DST")
}

func DialTransparentPassthrough(_ net.Addr) (net.Conn, error) {
	return nil, fmt.Errorf("transparent passthrough upstream sockets require Linux socket marks")
}

func NewTransparentPassthroughHTTPTransport() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	return transport
}
