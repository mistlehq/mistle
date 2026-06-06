package control

import (
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/mistle/sandboxd/protocol"
)

func TestSubmitActivateWritesControlRequestAndAcceptsSuccessResponse(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	requests, closeServer := startControlProtocolServer(t, socketPath, OKResponse(nil))
	defer closeServer()

	requireNoError(t, SubmitActivate(socketPath, controlClientActivationInput()))

	request := <-requests
	assertEqual(t, request.Type, RequestActivate)
	if request.ActivationInput == nil {
		t.Fatalf("expected activation input in control request")
	}
	assertEqual(t, request.ActivationInput.OperationKind, protocol.ActivationOperationStart)
	assertEqual(t, request.ActivationInput.BootstrapToken, "bootstrap-token-value")
}

func TestSubmitActivateReturnsControlErrorResponse(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	requests, closeServer := startControlProtocolServer(t, socketPath, ErrorResponse("activation rejected"))
	defer closeServer()

	err := SubmitActivate(socketPath, controlClientActivationInput())

	if err == nil {
		t.Fatalf("expected control error response")
	}
	assertEqual(t, err.Error(), "control socket returned an error: activation rejected")
	<-requests
}

func TestSubmitReadyWritesReadyRequestAndAcceptsSuccessResponse(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	requests, closeServer := startControlProtocolServer(t, socketPath, OKResponse(nil))
	defer closeServer()

	requireNoError(t, SubmitReady(socketPath))

	request := <-requests
	assertEqual(t, request.Type, RequestReady)
}

func TestSubmitShutdownWritesShutdownRequestAndAcceptsSuccessResponse(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	requests, closeServer := startControlProtocolServer(t, socketPath, OKResponse(nil))
	defer closeServer()

	requireNoError(t, SubmitShutdown(socketPath))

	request := <-requests
	assertEqual(t, request.Type, RequestShutdown)
}

func TestSubmitSigningRequiresSignatureInSuccessResponse(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	requests, closeServer := startControlProtocolServer(t, socketPath, OKResponse(nil))
	defer closeServer()

	_, err := SubmitSigning(socketPath, SignRequest{KeyRef: "key", PayloadBase64: "cGF5bG9hZA=="})

	if err == nil {
		t.Fatalf("expected missing signature response to fail")
	}
	assertEqual(t, err.Error(), "control socket signing response did not include a signature")
	request := <-requests
	assertEqual(t, request.Type, RequestSign)
}

func startControlProtocolServer(
	t *testing.T,
	socketPath string,
	response Response,
) (<-chan Request, func()) {
	t.Helper()
	listener, err := net.Listen("unix", socketPath)
	requireNoError(t, err)
	requests := make(chan Request, 1)
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
		request, err := DecodeRequest(requestBytes)
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

func controlClientActivationInput() protocol.ActivationInput {
	return protocol.ActivationInput{
		OperationKind:       protocol.ActivationOperationStart,
		BootstrapToken:      "bootstrap-token-value",
		TunnelExchangeToken: "tunnel-exchange-token-value",
		TunnelGatewayWSURL:  "ws://127.0.0.1:5003/tunnel/sandbox/sbi_control",
		RuntimePlan:         []byte(`{"sandboxProfileId":"sbp_control","version":1}`),
		ActingUserID:        nil,
		GitIdentity:         nil,
	}
}

func shortUnixSocketPath(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "sbd-control-*")
	requireNoError(t, err)
	t.Cleanup(func() {
		_ = os.RemoveAll(dir)
	})
	return filepath.Join(dir, "control.sock")
}
