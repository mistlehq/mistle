package bootstrap

import (
	"bytes"
	"fmt"
	"io"
)

const DefaultBootstrapTokenMaxBytes = 16 * 1024

type ReadBootstrapTokenInput struct {
	Reader   io.Reader
	MaxBytes int
}

func ReadBootstrapToken(input ReadBootstrapTokenInput) ([]byte, error) {
	if input.Reader == nil {
		return nil, fmt.Errorf("bootstrap token reader is required")
	}
	if input.MaxBytes < 1 {
		return nil, fmt.Errorf("bootstrap token max bytes must be at least 1")
	}

	limitedReader := io.LimitReader(input.Reader, int64(input.MaxBytes)+1)
	tokenBytes, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, fmt.Errorf("failed to read bootstrap token from stdin: %w", err)
	}
	if len(tokenBytes) > input.MaxBytes {
		return nil, fmt.Errorf("bootstrap token exceeds max size of %d bytes", input.MaxBytes)
	}

	normalizedTokenBytes := bytes.TrimSpace(tokenBytes)
	if len(normalizedTokenBytes) == 0 {
		return nil, fmt.Errorf("bootstrap token from stdin is empty")
	}

	bootstrapToken := make([]byte, len(normalizedTokenBytes))
	copy(bootstrapToken, normalizedTokenBytes)

	return bootstrapToken, nil
}
