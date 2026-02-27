package bootstrap

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

const DefaultStartupInputMaxBytes = 16 * 1024

type StartupInput struct {
	BootstrapToken   string `json:"bootstrapToken"`
	TunnelGatewayURL string `json:"tunnelGatewayWsUrl"`
}

type ReadStartupInputInput struct {
	Reader   io.Reader
	MaxBytes int
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

	var startupInput StartupInput
	decodeError := json.Unmarshal(normalizedStartupInput, &startupInput)
	if decodeError != nil {
		return StartupInput{}, fmt.Errorf("startup input from stdin must be valid json: %w", decodeError)
	}

	normalizedBootstrapToken := bytes.TrimSpace([]byte(startupInput.BootstrapToken))
	if len(normalizedBootstrapToken) == 0 {
		return StartupInput{}, fmt.Errorf("startup input bootstrap token is required")
	}

	normalizedGatewayURL := bytes.TrimSpace([]byte(startupInput.TunnelGatewayURL))
	if len(normalizedGatewayURL) == 0 {
		return StartupInput{}, fmt.Errorf("startup input tunnel gateway ws url is required")
	}

	bootstrapToken := make([]byte, len(normalizedBootstrapToken))
	copy(bootstrapToken, normalizedBootstrapToken)

	return StartupInput{
		BootstrapToken:   string(bootstrapToken),
		TunnelGatewayURL: string(normalizedGatewayURL),
	}, nil
}
