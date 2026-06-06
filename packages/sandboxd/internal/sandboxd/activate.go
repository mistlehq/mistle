package sandboxd

import (
	"encoding/json"
	"fmt"
	"io"

	"github.com/mistle/sandboxd/control"
	"github.com/mistle/sandboxd/protocol"
)

type activateResponse struct {
	OK    bool    `json:"ok"`
	Error *string `json:"error,omitempty"`
}

func RunActivate(
	stdin io.Reader,
	stdout io.Writer,
	controlSocketPath string,
	payloadSource StartupPayloadSource,
) error {
	rawRequest, err := ReadStartupPayload(stdin, payloadSource)
	if err != nil {
		activateErr := fmt.Errorf("failed to read sandbox activate request: %w", err)
		if responseErr := writeActivateErrorResponse(stdout, activateErr); responseErr != nil {
			return responseErr
		}
		return activateErr
	}

	activationInput, err := protocol.DecodeActivationInput(rawRequest)
	if err != nil {
		activateErr := fmt.Errorf("sandbox activate request must be valid json: %w", err)
		if responseErr := writeActivateErrorResponse(stdout, activateErr); responseErr != nil {
			return responseErr
		}
		return activateErr
	}

	if err := control.SubmitActivate(controlSocketPath, activationInput); err != nil {
		activateErr := fmt.Errorf("failed to submit sandbox activate request: %w", err)
		if responseErr := writeActivateErrorResponse(stdout, activateErr); responseErr != nil {
			return responseErr
		}
		return activateErr
	}

	return writeActivateResponse(stdout, activateResponse{OK: true})
}

func writeActivateErrorResponse(stdout io.Writer, activateErr error) error {
	errorText := activateErr.Error()
	return writeActivateResponse(stdout, activateResponse{OK: false, Error: &errorText})
}

func writeActivateResponse(stdout io.Writer, response activateResponse) error {
	encoder := json.NewEncoder(stdout)
	if err := encoder.Encode(response); err != nil {
		return fmt.Errorf("failed to write sandbox activate response: %w", err)
	}
	return nil
}
