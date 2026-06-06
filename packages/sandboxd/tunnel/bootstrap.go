package tunnel

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/coder/websocket"
)

type BootstrapTunnel struct {
	connectedURL string
	connection   *websocket.Conn
}

func ConnectBootstrapTunnel(ctx context.Context, gatewayWSURL string, bootstrapToken string) (*BootstrapTunnel, error) {
	normalizedToken := strings.TrimSpace(bootstrapToken)
	if normalizedToken == "" {
		return nil, fmt.Errorf("sandbox tunnel bootstrap token is required")
	}
	parsedURL, err := url.Parse(gatewayWSURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse sandbox tunnel gateway ws url: %w", err)
	}
	switch parsedURL.Scheme {
	case "ws", "wss":
	default:
		return nil, fmt.Errorf("sandbox tunnel gateway ws url must use ws or wss scheme")
	}
	tokenQuery := "bootstrap_token=" + url.QueryEscape(normalizedToken)
	if parsedURL.RawQuery == "" {
		parsedURL.RawQuery = tokenQuery
	} else {
		parsedURL.RawQuery += "&" + tokenQuery
	}
	connectedURL := parsedURL.String()

	connection, _, err := websocket.Dial(ctx, connectedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to connect bootstrap tunnel: %w", err)
	}
	return &BootstrapTunnel{connectedURL: connectedURL, connection: connection}, nil
}

func (tunnel *BootstrapTunnel) ConnectedURL() string {
	return tunnel.connectedURL
}

func (tunnel *BootstrapTunnel) SendText(ctx context.Context, payload string) error {
	if tunnel.connection == nil {
		return fmt.Errorf("bootstrap tunnel is already closed")
	}
	if err := tunnel.connection.Write(ctx, websocket.MessageText, []byte(payload)); err != nil {
		return fmt.Errorf("failed to write bootstrap tunnel text frame: %w", err)
	}
	return nil
}

func (tunnel *BootstrapTunnel) ReadText(ctx context.Context) (string, error) {
	if tunnel.connection == nil {
		return "", fmt.Errorf("bootstrap tunnel is already closed")
	}
	messageType, payload, err := tunnel.connection.Read(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to read bootstrap tunnel frame: %w", err)
	}
	if messageType != websocket.MessageText {
		return "", fmt.Errorf("invalid bootstrap tunnel control frame: expected text frame")
	}
	return string(payload), nil
}

func (tunnel *BootstrapTunnel) Close() error {
	if tunnel.connection == nil {
		return nil
	}
	connection := tunnel.connection
	tunnel.connection = nil
	if err := connection.Close(websocket.StatusNormalClosure, ""); err != nil {
		return fmt.Errorf("failed to close bootstrap tunnel: %w", err)
	}
	return nil
}
