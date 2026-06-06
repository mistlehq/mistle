package control

import (
	"encoding/json"
	"fmt"
	"io"
	"net"

	"github.com/mistle/sandboxd/protocol"
)

func SubmitReady(socketPath string) error {
	_, err := submitControlRequest(socketPath, Request{Type: RequestReady})
	return err
}

func SubmitShutdown(socketPath string) error {
	_, err := submitControlRequest(socketPath, Request{Type: RequestShutdown})
	return err
}

func SubmitActivate(socketPath string, activationInput protocol.ActivationInput) error {
	_, err := submitControlRequest(socketPath, Request{
		Type:            RequestActivate,
		ActivationInput: &activationInput,
	})
	return err
}

func SubmitSigning(socketPath string, signRequest SignRequest) (string, error) {
	response, err := submitControlRequest(socketPath, Request{
		Type:        RequestSign,
		SignRequest: &signRequest,
	})
	if err != nil {
		return "", err
	}
	if response.SignatureBase64 == nil {
		return "", fmt.Errorf("control socket signing response did not include a signature")
	}
	return *response.SignatureBase64, nil
}

func submitControlRequest(socketPath string, request Request) (Response, error) {
	connection, err := net.Dial("unix", socketPath)
	if err != nil {
		return Response{}, fmt.Errorf("failed to connect to control socket %s: %w", socketPath, err)
	}
	defer connection.Close()

	requestBytes, err := json.Marshal(request)
	if err != nil {
		return Response{}, fmt.Errorf("failed to serialize control socket request: %w", err)
	}
	if _, err := connection.Write(requestBytes); err != nil {
		return Response{}, fmt.Errorf("failed to write control socket request: %w", err)
	}
	if unixConnection, ok := connection.(*net.UnixConn); ok {
		if err := unixConnection.CloseWrite(); err != nil {
			return Response{}, fmt.Errorf("failed to write control socket request: %w", err)
		}
	}

	responseBytes, err := io.ReadAll(connection)
	if err != nil {
		return Response{}, fmt.Errorf("failed to read control socket response: %w", err)
	}
	response, err := DecodeResponse(responseBytes)
	if err != nil {
		return Response{}, fmt.Errorf("control socket response must be valid json: %w", err)
	}
	if !response.OK {
		if response.Error == nil {
			return Response{}, fmt.Errorf("control socket returned ok=false without an error")
		}
		return Response{}, fmt.Errorf("control socket returned an error: %s", *response.Error)
	}
	return response, nil
}
