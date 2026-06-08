package tunnel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/coder/websocket"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const tunnelWebSocketReadLimitBytes = int64(tunnelprotocol.MaxStreamWindowBytes + tunnelprotocol.DataFrameHeaderLen)

type TunnelExchangeResult struct {
	BootstrapToken      string
	TunnelExchangeToken string
}

type TunnelExchangeErrorKind string

const (
	TunnelExchangeErrorRetryable TunnelExchangeErrorKind = "retryable"
	TunnelExchangeErrorTerminal  TunnelExchangeErrorKind = "terminal"
)

type TunnelExchangeError struct {
	Kind    TunnelExchangeErrorKind
	Message string
}

func (err *TunnelExchangeError) Error() string {
	return err.Message
}

type BootstrapTunnel struct {
	connectedURL string
	connection   *websocket.Conn
}

func ConnectBootstrapTunnel(ctx context.Context, gatewayWSURL string, bootstrapToken string) (*BootstrapTunnel, error) {
	connectedURL, err := ResolveBootstrapTunnelURL(gatewayWSURL, bootstrapToken)
	if err != nil {
		return nil, err
	}

	connection, _, err := websocket.Dial(ctx, connectedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to connect bootstrap tunnel: %w", err)
	}
	connection.SetReadLimit(tunnelWebSocketReadLimitBytes)
	return &BootstrapTunnel{connectedURL: connectedURL, connection: connection}, nil
}

func ResolveBootstrapTunnelURL(gatewayWSURL string, bootstrapToken string) (string, error) {
	normalizedToken := strings.TrimSpace(bootstrapToken)
	if normalizedToken == "" {
		return "", fmt.Errorf("sandbox tunnel bootstrap token is required")
	}
	parsedURL, err := url.Parse(gatewayWSURL)
	if err != nil {
		return "", fmt.Errorf("failed to parse sandbox tunnel gateway ws url: %w", err)
	}
	switch parsedURL.Scheme {
	case "ws", "wss":
	default:
		return "", fmt.Errorf("sandbox tunnel gateway ws url must use ws or wss scheme")
	}
	query := parsedURL.Query()
	query.Add("bootstrap_token", normalizedToken)
	parsedURL.RawQuery = query.Encode()
	return parsedURL.String(), nil
}

func ResolveTunnelExchangeURL(gatewayWSURL string) (string, error) {
	parsedURL, err := url.Parse(gatewayWSURL)
	if err != nil {
		return "", fmt.Errorf("failed to parse sandbox tunnel gateway ws url: %w", err)
	}
	switch parsedURL.Scheme {
	case "ws":
		parsedURL.Scheme = "http"
	case "wss":
		parsedURL.Scheme = "https"
	default:
		return "", fmt.Errorf("sandbox tunnel gateway ws url must use ws or wss scheme")
	}
	parsedURL.Path = strings.TrimRight(parsedURL.Path, "/") + "/token-exchange"
	return parsedURL.String(), nil
}

func ExchangeTunnelToken(ctx context.Context, client *http.Client, exchangeURL string, tunnelExchangeToken string) (TunnelExchangeResult, error) {
	normalizedToken := strings.TrimSpace(tunnelExchangeToken)
	if normalizedToken == "" {
		return TunnelExchangeResult{}, &TunnelExchangeError{
			Kind:    TunnelExchangeErrorRetryable,
			Message: "sandbox tunnel exchange token is required",
		}
	}
	if client == nil {
		return TunnelExchangeResult{}, fmt.Errorf("tunnel exchange http client is required")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, exchangeURL, nil)
	if err != nil {
		return TunnelExchangeResult{}, fmt.Errorf("failed to build tunnel exchange request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+normalizedToken)
	request.Header.Set("Content-Length", "0")

	response, err := client.Do(request)
	if err != nil {
		return TunnelExchangeResult{}, &TunnelExchangeError{
			Kind:    TunnelExchangeErrorRetryable,
			Message: err.Error(),
		}
	}
	defer response.Body.Close()

	responseBytes, err := io.ReadAll(response.Body)
	if err != nil {
		return TunnelExchangeResult{}, &TunnelExchangeError{
			Kind:    TunnelExchangeErrorRetryable,
			Message: err.Error(),
		}
	}
	switch response.StatusCode {
	case http.StatusOK:
		var responseBody map[string]string
		if err := json.Unmarshal(responseBytes, &responseBody); err != nil {
			return TunnelExchangeResult{}, &TunnelExchangeError{
				Kind:    TunnelExchangeErrorRetryable,
				Message: err.Error(),
			}
		}
		bootstrapToken := strings.TrimSpace(responseBody["bootstrapToken"])
		nextExchangeToken := strings.TrimSpace(responseBody["tunnelExchangeToken"])
		if bootstrapToken == "" || nextExchangeToken == "" {
			return TunnelExchangeResult{}, &TunnelExchangeError{
				Kind:    TunnelExchangeErrorRetryable,
				Message: "tunnel exchange response must include non-empty bootstrapToken and tunnelExchangeToken",
			}
		}
		return TunnelExchangeResult{BootstrapToken: bootstrapToken, TunnelExchangeToken: nextExchangeToken}, nil
	case http.StatusUnauthorized, http.StatusNotFound, http.StatusConflict:
		return TunnelExchangeResult{}, &TunnelExchangeError{
			Kind:    TunnelExchangeErrorTerminal,
			Message: tunnelExchangeErrorMessage(response.StatusCode, responseBytes),
		}
	default:
		return TunnelExchangeResult{}, &TunnelExchangeError{
			Kind:    TunnelExchangeErrorRetryable,
			Message: tunnelExchangeErrorMessage(response.StatusCode, responseBytes),
		}
	}
}

func tunnelExchangeErrorMessage(statusCode int, responseBody []byte) string {
	if len(responseBody) == 0 {
		return fmt.Sprintf("token exchange returned status %d with an empty body", statusCode)
	}
	var decoded any
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return fmt.Sprintf("token exchange returned status %d with a non-JSON body", statusCode)
	}
	if fields, ok := decoded.(map[string]any); ok {
		if message, ok := fields["error"].(string); ok && strings.TrimSpace(message) != "" {
			return message
		}
		return fmt.Sprintf("token exchange returned unexpected status %d", statusCode)
	}
	return fmt.Sprintf("token exchange returned status %d with unexpected JSON body: %v", statusCode, decoded)
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
		if errors.Is(err, net.ErrClosed) || strings.Contains(err.Error(), "use of closed network connection") {
			return nil
		}
		return fmt.Errorf("failed to close bootstrap tunnel: %w", err)
	}
	return nil
}
