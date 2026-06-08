//go:build !linux

package security

import "net"

func ApplyCurrentProcessSecurity() error {
	return nil
}

func EnsureUnixSocketPeerMatchesCurrentProcessUID(connection *net.UnixConn) error {
	if connection == nil {
		return errUnixSocketConnectionRequired()
	}
	return nil
}
