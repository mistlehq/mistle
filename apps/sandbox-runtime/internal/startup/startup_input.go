package startup

import (
	"bytes"
	"encoding/json"
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

func decodeJSONStrict(input []byte, output any) error {
	decoder := json.NewDecoder(bytes.NewReader(input))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(output); err != nil {
		return err
	}

	if err := decoder.Decode(&struct{}{}); err != io.EOF {
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

	limitedReader := io.LimitReader(input.Reader, int64(input.MaxBytes)+1)
	startupInputBytes, err := io.ReadAll(limitedReader)
	if err != nil {
		return StartupInput{}, fmt.Errorf("failed to read startup input from stdin: %w", err)
	}
	if len(startupInputBytes) > input.MaxBytes {
		return StartupInput{}, fmt.Errorf("startup input exceeds max size of %d bytes", input.MaxBytes)
	}

	normalizedStartupInput := bytes.TrimSpace(startupInputBytes)
	if len(normalizedStartupInput) == 0 {
		return StartupInput{}, fmt.Errorf("startup input from stdin is empty")
	}

	var startupInputPayload readStartupInputPayload
	if decodeError := decodeJSONStrict(normalizedStartupInput, &startupInputPayload); decodeError != nil {
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
