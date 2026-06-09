//go:build linux

package egressproxy

import (
	"context"
	"net"
	"syscall"
	"testing"
)

func TestTransparentPassthroughHTTPTransportMarksOutboundSockets(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	defer listener.Close()
	accepted := make(chan net.Conn, 1)
	acceptErr := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			acceptErr <- err
			return
		}
		accepted <- connection
	}()

	transport := NewTransparentPassthroughHTTPTransport()
	connection, err := transport.DialContext(context.Background(), "tcp", listener.Addr().String())
	requireNoError(t, err)
	defer connection.Close()
	assertEqual(t, socketMark(t, connection), transparentPassthroughSocketMark)

	select {
	case upstream := <-accepted:
		requireNoError(t, upstream.Close())
	case err := <-acceptErr:
		t.Fatalf("expected listener to accept marked connection: %v", err)
	}
}

func socketMark(t *testing.T, connection net.Conn) int {
	t.Helper()
	tcpConnection, ok := connection.(*net.TCPConn)
	if !ok {
		t.Fatalf("expected tcp connection, got %T", connection)
	}
	rawConnection, err := tcpConnection.SyscallConn()
	requireNoError(t, err)
	mark := -1
	var controlErr error
	err = rawConnection.Control(func(fd uintptr) {
		mark, controlErr = syscall.GetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_MARK)
	})
	requireNoError(t, err)
	requireNoError(t, controlErr)
	if mark < 0 {
		t.Fatalf("expected socket mark to be non-negative, got %d", mark)
	}
	return mark
}
