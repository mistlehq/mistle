package tunnel

import (
	"bytes"
	"context"
	"fmt"
	"net/url"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

const bootstrapTokenQueryParam = "bootstrap_token"

type RunInput struct {
	Context        context.Context
	GatewayWSURL   string
	BootstrapToken []byte
	RuntimeClients []startup.RuntimeClient
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

	var activePTYSession *ptySession
	defer func() {
		if activePTYSession == nil || activePTYSession.IsExited() {
			return
		}
		_, _ = activePTYSession.Terminate()
		_ = activePTYSession.CloseTerminal()
	}()

	for {
		connectRequest, err := readConnectRequest(input.Context, conn)
		if err != nil {
			if input.Context.Err() != nil {
				return nil
			}
			return fmt.Errorf("sandbox tunnel websocket read failed: %w", err)
		}

		switch connectRequest.ChannelKind {
		case sessionprotocol.ChannelKindAgent:
			err := handleAgentConnectRequest(
				input.Context,
				conn,
				connectRequest,
				input.RuntimeClients,
			)
			if err != nil {
				if input.Context.Err() != nil {
					return nil
				}
				return err
			}
		case sessionprotocol.ChannelKindPTY:
			updatedPTYSession, err := handlePTYConnectRequest(
				input.Context,
				conn,
				connectRequest,
				activePTYSession,
			)
			if err != nil {
				if input.Context.Err() != nil {
					return nil
				}
				return err
			}
			activePTYSession = updatedPTYSession
		default:
			if err := writeConnectError(input.Context, conn, sessionprotocol.ConnectError{
				Type:      sessionprotocol.MessageTypeConnectError,
				RequestID: connectRequest.RequestID,
				Code:      connectErrorCodeUnsupportedChannel,
				Message:   fmt.Sprintf("channel kind '%s' is not supported", connectRequest.ChannelKind),
			}); err != nil {
				return fmt.Errorf("failed to write sandbox tunnel connect error: %w", err)
			}
		}
	}
}
