package tunnel

import (
	"bytes"
	"context"
	"fmt"
	"net/url"

	"github.com/coder/websocket"
)

const bootstrapTokenQueryParam = "bootstrap_token"

type RunInput struct {
	Context        context.Context
	GatewayWSURL   string
	BootstrapToken []byte
}

func parseGatewayURL(gatewayWSURL string) (*url.URL, error) {
	parsedURL, err := url.Parse(gatewayWSURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse sandbox tunnel gateway ws url: %w", err)
	}

	if parsedURL.Scheme != "ws" && parsedURL.Scheme != "wss" {
		return nil, fmt.Errorf("sandbox tunnel gateway ws url must use ws or wss scheme")
	}

	return parsedURL, nil
}

func normalizeBootstrapToken(bootstrapToken []byte) (string, error) {
	normalizedToken := bytes.TrimSpace(bootstrapToken)
	if len(normalizedToken) == 0 {
		return "", fmt.Errorf("sandbox tunnel bootstrap token is required")
	}

	return string(normalizedToken), nil
}

func Run(input RunInput) error {
	if input.Context == nil {
		return fmt.Errorf("sandbox tunnel context is required")
	}

	parsedGatewayURL, err := parseGatewayURL(input.GatewayWSURL)
	if err != nil {
		return err
	}

	bootstrapToken, err := normalizeBootstrapToken(input.BootstrapToken)
	if err != nil {
		return err
	}

	query := parsedGatewayURL.Query()
	query.Set(bootstrapTokenQueryParam, bootstrapToken)
	parsedGatewayURL.RawQuery = query.Encode()

	conn, _, err := websocket.Dial(input.Context, parsedGatewayURL.String(), nil)
	if err != nil {
		return fmt.Errorf("failed to dial sandbox tunnel websocket: %w", err)
	}
	defer conn.CloseNow()

	for {
		_, _, err := conn.Read(input.Context)
		if err == nil {
			continue
		}

		if input.Context.Err() != nil {
			return nil
		}

		return fmt.Errorf("sandbox tunnel websocket read failed: %w", err)
	}
}
