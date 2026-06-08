//go:build linux

package security

import (
	"net"
	"os"
	"syscall"
	"testing"
)

func TestApplyCurrentProcessSecuritySetsNonDumpable(t *testing.T) {
	requireNoError(t, ApplyCurrentProcessSecurity())

	dumpable, _, errno := syscall.Syscall6(syscall.SYS_PRCTL, syscall.PR_GET_DUMPABLE, 0, 0, 0, 0, 0)

	if errno != 0 {
		t.Fatalf("expected dumpable state to be readable, got %v", errno)
	}
	if dumpable != 0 {
		t.Fatalf("expected current process to be non-dumpable, got %d", dumpable)
	}
}

func TestEnsureUnixSocketPeerMatchesCurrentProcessUIDAcceptsSameUIDPeer(t *testing.T) {
	client, server := unixSocketPair(t)
	requireNoError(t, client.Close())
	defer server.Close()

	requireNoError(t, EnsureUnixSocketPeerMatchesCurrentProcessUID(server))
}

func unixSocketPair(t *testing.T) (*net.UnixConn, *net.UnixConn) {
	t.Helper()
	fileDescriptors, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	requireNoError(t, err)
	clientFile := fileFromDescriptor(uintptr(fileDescriptors[0]), "security-client")
	serverFile := fileFromDescriptor(uintptr(fileDescriptors[1]), "security-server")
	clientConnection, err := net.FileConn(clientFile)
	requireNoError(t, err)
	serverConnection, err := net.FileConn(serverFile)
	requireNoError(t, err)
	requireNoError(t, clientFile.Close())
	requireNoError(t, serverFile.Close())
	clientUnixConnection, ok := clientConnection.(*net.UnixConn)
	if !ok {
		t.Fatalf("expected client connection to be a unix connection")
	}
	serverUnixConnection, ok := serverConnection.(*net.UnixConn)
	if !ok {
		t.Fatalf("expected server connection to be a unix connection")
	}
	return clientUnixConnection, serverUnixConnection
}

func fileFromDescriptor(fileDescriptor uintptr, name string) *os.File {
	return os.NewFile(fileDescriptor, name)
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}
