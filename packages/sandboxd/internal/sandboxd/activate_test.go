package sandboxd

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mistle/sandboxd/control"
	"github.com/mistle/sandboxd/protocol"
)

func TestRunActivateSubmitsActivationInputAndWritesOKResponse(t *testing.T) {
	socketPath := shortActivateUnixSocketPath(t)
	requests, closeServer := startActivateControlServer(t, socketPath, control.OKResponse(nil))
	defer closeServer()
	var stdout bytes.Buffer

	err := RunActivate(strings.NewReader(validActivationInputJSON()), &stdout, socketPath, StartupPayloadSource{Kind: StartupPayloadUntilEOF})
	requireNoError(t, err)

	response, err := protocol.DecodeActivationResponse(stdout.Bytes())
	requireNoError(t, err)
	assertEqual(t, response.OK, true)
	request := <-requests
	assertEqual(t, request.Type, control.RequestActivate)
	assertEqual(t, request.ActivationInput.BootstrapToken, "bootstrap-token-value")
}

func TestRunActivateWritesErrorResponseForInvalidActivationInput(t *testing.T) {
	var stdout bytes.Buffer

	err := RunActivate(strings.NewReader(`{"startupMode":"new"}`), &stdout, filepath.Join(t.TempDir(), "missing.sock"), StartupPayloadSource{Kind: StartupPayloadUntilEOF})

	if err == nil {
		t.Fatalf("expected invalid activation input to fail")
	}
	response, decodeErr := protocol.DecodeActivationResponse(stdout.Bytes())
	requireNoError(t, decodeErr)
	assertEqual(t, response.OK, false)
	if !strings.Contains(response.Error, "sandbox activate request must be valid json") {
		t.Fatalf("expected invalid request error response, got %q", response.Error)
	}
}

func TestRunActivateWritesErrorResponseForControlSocketFailure(t *testing.T) {
	socketPath := shortActivateUnixSocketPath(t)
	requests, closeServer := startActivateControlServer(t, socketPath, control.ErrorResponse("activation rejected"))
	defer closeServer()
	var stdout bytes.Buffer

	err := RunActivate(strings.NewReader(validActivationInputJSON()), &stdout, socketPath, StartupPayloadSource{Kind: StartupPayloadUntilEOF})

	if err == nil {
		t.Fatalf("expected control socket error to fail activation")
	}
	response, decodeErr := protocol.DecodeActivationResponse(stdout.Bytes())
	requireNoError(t, decodeErr)
	assertEqual(t, response.OK, false)
	if !strings.Contains(response.Error, "failed to submit sandbox activate request") {
		t.Fatalf("expected submit failure response, got %q", response.Error)
	}
	<-requests
}

func TestRunDispatchesActivateCommand(t *testing.T) {
	socketPath := shortActivateUnixSocketPath(t)
	requests, closeServer := startActivateControlServer(t, socketPath, control.OKResponse(nil))
	defer closeServer()
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	code := runWithControlSocket(
		"sandboxd",
		[]string{"activate"},
		strings.NewReader(validActivationInputJSON()),
		&stdout,
		&stderr,
		socketPath,
	)

	assertEqual(t, code, 0)
	assertEqual(t, stderr.String(), "")
	response, err := protocol.DecodeActivationResponse(stdout.Bytes())
	requireNoError(t, err)
	assertEqual(t, response.OK, true)
	<-requests
}

func startActivateControlServer(
	t *testing.T,
	socketPath string,
	response control.Response,
) (<-chan control.Request, func()) {
	t.Helper()
	listener, err := net.Listen("unix", socketPath)
	requireNoError(t, err)
	requests := make(chan control.Request, 1)
	done := make(chan struct{})

	go func() {
		defer close(done)
		defer close(requests)
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		defer connection.Close()
		requestBytes, err := io.ReadAll(connection)
		if err != nil {
			return
		}
		request, err := control.DecodeRequest(requestBytes)
		if err != nil {
			return
		}
		requests <- request
		responseBytes, err := json.Marshal(response)
		if err != nil {
			return
		}
		_, _ = connection.Write(responseBytes)
	}()

	return requests, func() {
		_ = listener.Close()
		<-done
		_ = os.Remove(socketPath)
	}
}

func validActivationInputJSON() string {
	return `{
		"operationKind":"start",
		"bootstrapToken":"bootstrap-token-value",
		"tunnelExchangeToken":"tunnel-exchange-token-value",
		"tunnelGatewayWsUrl":"ws://127.0.0.1:5003/tunnel/sandbox",
		"runtimePlan":{"version":1},
		"actingUserId":null,
		"gitIdentity":null
	}`
}

func shortActivateUnixSocketPath(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "sbd-activate-*")
	requireNoError(t, err)
	t.Cleanup(func() {
		_ = os.RemoveAll(dir)
	})
	return filepath.Join(dir, "control.sock")
}
