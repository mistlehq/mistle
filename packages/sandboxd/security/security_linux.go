//go:build linux

package security

import (
	"fmt"
	"net"
	"os"
	"syscall"
)

func ApplyCurrentProcessSecurity() error {
	_, _, errno := syscall.Syscall6(syscall.SYS_PRCTL, syscall.PR_SET_DUMPABLE, 0, 0, 0, 0, 0)
	if errno != 0 {
		return fmt.Errorf("failed to set current process non-dumpable: %w", errno)
	}
	return nil
}

func EnsureUnixSocketPeerMatchesCurrentProcessUID(connection *net.UnixConn) error {
	if connection == nil {
		return errUnixSocketConnectionRequired()
	}
	rawConnection, err := connection.SyscallConn()
	if err != nil {
		return fmt.Errorf("failed to access unix socket connection fd: %w", err)
	}
	var credentials *syscall.Ucred
	var readErr error
	controlErr := rawConnection.Control(func(fd uintptr) {
		credentials, readErr = syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	})
	if controlErr != nil {
		return fmt.Errorf("failed to read unix socket peer credentials: %w", controlErr)
	}
	if readErr != nil {
		return fmt.Errorf("failed to read unix socket peer credentials: %w", readErr)
	}
	if credentials == nil {
		return fmt.Errorf("failed to read unix socket peer credentials: no credentials returned")
	}
	currentUID := uint32(os.Geteuid())
	if credentials.Uid != currentUID {
		return fmt.Errorf("control socket connection must come from uid %d, got uid %d", currentUID, credentials.Uid)
	}
	return nil
}
