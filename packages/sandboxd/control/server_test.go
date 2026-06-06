package control

import (
	"encoding/json"
	"io"
	"net"
	"os"
	"strings"
	"testing"
	"time"
)

func TestServerHandlesReadyAndShutdownRequests(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	waitForControlSocket(t, socketPath)

	requireNoError(t, SubmitReady(socketPath))
	requireNoError(t, SubmitShutdown(socketPath))
	requireNoError(t, server.Wait())
	if _, err := os.Lstat(socketPath); !os.IsNotExist(err) {
		t.Fatalf("expected control socket to be removed after shutdown, got %v", err)
	}
}

func TestServerReturnsControlErrorForActivationUntilDaemonActivationIsMigrated(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)

	err = SubmitActivate(socketPath, controlClientActivationInput())

	if err == nil {
		t.Fatalf("expected activation to fail before daemon activation is migrated")
	}
	assertEqual(t, err.Error(), "control socket returned an error: sandbox startup request was rejected: daemon activation is not migrated to Go")
}

func TestServerReturnsProtocolErrorForInvalidRequestPayload(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)
	connection, err := net.Dial("unix", socketPath)
	requireNoError(t, err)
	_, err = connection.Write([]byte(`{"type":"ready","activationInput":{}}`))
	requireNoError(t, err)
	if unixConnection, ok := connection.(*net.UnixConn); ok {
		requireNoError(t, unixConnection.CloseWrite())
	}

	responseBytes, err := io.ReadAll(connection)

	requireNoError(t, err)
	var response Response
	requireNoError(t, json.Unmarshal(responseBytes, &response))
	assertEqual(t, response.OK, false)
	if response.Error == nil || !strings.Contains(*response.Error, "control ready request must not include a payload") {
		t.Fatalf("expected protocol error response, got %s", string(responseBytes))
	}
	requireNoError(t, connection.Close())
}

func TestStartServerRejectsExistingNonSocketPath(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	requireNoError(t, os.WriteFile(socketPath, []byte("not a socket"), 0o600))

	_, err := StartServer(socketPath)

	if err == nil {
		t.Fatalf("expected existing non-socket path to fail")
	}
	if !strings.Contains(err.Error(), "already exists and is not a unix socket") {
		t.Fatalf("expected existing non-socket error, got %q", err.Error())
	}
}

func waitForControlSocket(t *testing.T, socketPath string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if metadata, err := os.Lstat(socketPath); err == nil && metadata.Mode()&os.ModeSocket != 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("control socket %s was not created", socketPath)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
