package startup

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const DefaultStartupInputMaxBytes = 1024 * 1024

type StartupInput struct {
	BootstrapToken   string      `json:"bootstrapToken"`
	TunnelGatewayURL string      `json:"tunnelGatewayWsUrl"`
	RuntimePlan      RuntimePlan `json:"runtimePlan"`
}

type readStartupInputPayload struct {
	BootstrapToken   *string      `json:"bootstrapToken"`
	TunnelGatewayURL *string      `json:"tunnelGatewayWsUrl"`
	RuntimePlan      *RuntimePlan `json:"runtimePlan"`
}

type ReadStartupInputInput struct {
	Reader   io.Reader
	MaxBytes int
}

func decodeJSONStrict(reader io.Reader, maxBytes int, output any) error {
	limitedReader := &io.LimitedReader{
		R: reader,
		N: int64(maxBytes) + 1,
	}
	decoder := json.NewDecoder(limitedReader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(output); err != nil {
		if limitedReader.N == 0 {
			return fmt.Errorf("startup input exceeds max size of %d bytes", maxBytes)
		}
		return err
	}

	if decoder.InputOffset() > int64(maxBytes) {
		return fmt.Errorf("startup input exceeds max size of %d bytes", maxBytes)
	}

	bufferedTrailingJSON, err := io.ReadAll(decoder.Buffered())
	if err != nil {
		return fmt.Errorf("failed to read trailing startup input bytes: %w", err)
	}
	if len(bytes.TrimSpace(bufferedTrailingJSON)) > 0 {
		return fmt.Errorf("unexpected trailing JSON content")
	}

	return nil
}

func ReadStartupInput(input ReadStartupInputInput) (StartupInput, error) {
	if input.Reader == nil {
		return StartupInput{}, fmt.Errorf("startup input reader is required")
	}
	if input.MaxBytes < 1 {
		return StartupInput{}, fmt.Errorf("startup input max bytes must be at least 1")
	}

	var startupInputPayload readStartupInputPayload
	if decodeError := decodeJSONStrict(input.Reader, input.MaxBytes, &startupInputPayload); decodeError != nil {
		if errors.Is(decodeError, io.EOF) {
			return StartupInput{}, fmt.Errorf("startup input from stdin is empty")
		}
		return StartupInput{}, fmt.Errorf("startup input from stdin must be valid json: %w", decodeError)
	}

	if startupInputPayload.BootstrapToken == nil {
		return StartupInput{}, fmt.Errorf("startup input bootstrap token is required")
	}
	normalizedBootstrapToken := strings.TrimSpace(*startupInputPayload.BootstrapToken)
	if normalizedBootstrapToken == "" {
		return StartupInput{}, fmt.Errorf("startup input bootstrap token is required")
	}

	if startupInputPayload.TunnelGatewayURL == nil {
		return StartupInput{}, fmt.Errorf("startup input tunnel gateway ws url is required")
	}
	normalizedGatewayURL := strings.TrimSpace(*startupInputPayload.TunnelGatewayURL)
	if normalizedGatewayURL == "" {
		return StartupInput{}, fmt.Errorf("startup input tunnel gateway ws url is required")
	}

	if startupInputPayload.RuntimePlan == nil {
		return StartupInput{}, fmt.Errorf("startup input runtime plan is required")
	}
	if err := ValidateRuntimePlan(*startupInputPayload.RuntimePlan); err != nil {
		return StartupInput{}, fmt.Errorf("startup input runtime plan is invalid: %w", err)
	}

	return StartupInput{
		BootstrapToken:   normalizedBootstrapToken,
		TunnelGatewayURL: normalizedGatewayURL,
		RuntimePlan:      *startupInputPayload.RuntimePlan,
	}, nil
}
