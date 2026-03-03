package tunnel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

const bootstrapTokenQueryParam = "bootstrap_token"
const agentEndpointDialTimeout = 5 * time.Second

const (
	connectErrorCodeUnsupportedChannel        = "unsupported_channel"
	connectErrorCodeAgentEndpointUnavailable  = "agent_endpoint_unavailable"
	connectErrorCodeUnsupportedConnectionMode = "unsupported_connection_mode"
	connectErrorCodeAgentEndpointDialFailed   = "agent_endpoint_dial_failed"
)

type RunInput struct {
	Context        context.Context
	GatewayWSURL   string
	BootstrapToken []byte
	RuntimeClients []startup.RuntimeClient
}

type resolvedAgentEndpoint struct {
	ClientID       string
	EndpointKey    string
	ConnectionMode string
	TransportURL   string
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
		connectRequest, err := readConnectRequest(input.Context, conn)
		if err != nil {
			if input.Context.Err() != nil {
				return nil
			}
			return fmt.Errorf("sandbox tunnel websocket read failed: %w", err)
		}

		if connectRequest.Channel.Kind != sessionprotocol.ChannelKindAgent {
			if err := writeConnectError(input.Context, conn, sessionprotocol.ConnectError{
				Type:      sessionprotocol.MessageTypeConnectError,
				RequestID: connectRequest.RequestID,
				Code:      connectErrorCodeUnsupportedChannel,
				Message:   fmt.Sprintf("channel kind '%s' is not supported", connectRequest.Channel.Kind),
			}); err != nil {
				return fmt.Errorf("failed to write sandbox tunnel connect error: %w", err)
			}
			continue
		}

		agentEndpoint, err := resolveAgentEndpoint(input.RuntimeClients)
		if err != nil {
			if writeErr := writeConnectError(input.Context, conn, sessionprotocol.ConnectError{
				Type:      sessionprotocol.MessageTypeConnectError,
				RequestID: connectRequest.RequestID,
				Code:      connectErrorCodeAgentEndpointUnavailable,
				Message:   err.Error(),
			}); writeErr != nil {
				return fmt.Errorf("failed to write sandbox tunnel connect error: %w", writeErr)
			}
			continue
		}
		if agentEndpoint == nil {
			if writeErr := writeConnectError(input.Context, conn, sessionprotocol.ConnectError{
				Type:      sessionprotocol.MessageTypeConnectError,
				RequestID: connectRequest.RequestID,
				Code:      connectErrorCodeAgentEndpointUnavailable,
				Message:   "agent endpoint is not declared in runtime plan",
			}); writeErr != nil {
				return fmt.Errorf("failed to write sandbox tunnel connect error: %w", writeErr)
			}
			continue
		}

		if agentEndpoint.ConnectionMode != "dedicated" {
			if err := writeConnectError(input.Context, conn, sessionprotocol.ConnectError{
				Type:      sessionprotocol.MessageTypeConnectError,
				RequestID: connectRequest.RequestID,
				Code:      connectErrorCodeUnsupportedConnectionMode,
				Message:   fmt.Sprintf("connection mode '%s' is not supported", agentEndpoint.ConnectionMode),
			}); err != nil {
				return fmt.Errorf("failed to write sandbox tunnel connect error: %w", err)
			}
			continue
		}

		agentConn, err := dialAgentEndpoint(input.Context, agentEndpoint.TransportURL)
		if err != nil {
			if writeErr := writeConnectError(input.Context, conn, sessionprotocol.ConnectError{
				Type:      sessionprotocol.MessageTypeConnectError,
				RequestID: connectRequest.RequestID,
				Code:      connectErrorCodeAgentEndpointDialFailed,
				Message:   err.Error(),
			}); writeErr != nil {
				return fmt.Errorf("failed to write sandbox tunnel connect error: %w", writeErr)
			}
			continue
		}
		defer agentConn.CloseNow()

		if err := writeConnectOK(input.Context, conn, sessionprotocol.ConnectOK{
			Type:      sessionprotocol.MessageTypeConnectOK,
			RequestID: connectRequest.RequestID,
		}); err != nil {
			return fmt.Errorf("failed to write sandbox tunnel connect acknowledgement: %w", err)
		}

		if err := relayTunnelFrames(input.Context, conn, agentConn); err != nil {
			if input.Context.Err() != nil {
				return nil
			}
			return fmt.Errorf("sandbox tunnel websocket relay failed: %w", err)
		}

		return nil
	}
}

func readConnectRequest(ctx context.Context, tunnelConn *websocket.Conn) (sessionprotocol.AgentConnectRequest, error) {
	messageType, payload, err := tunnelConn.Read(ctx)
	if err != nil {
		return sessionprotocol.AgentConnectRequest{}, err
	}
	if messageType != websocket.MessageText {
		return sessionprotocol.AgentConnectRequest{}, fmt.Errorf(
			"expected connect request websocket text message, got %s",
			messageType.String(),
		)
	}

	var connectRequest sessionprotocol.AgentConnectRequest
	if err := json.Unmarshal(payload, &connectRequest); err != nil {
		return sessionprotocol.AgentConnectRequest{}, fmt.Errorf("connect request must be valid JSON: %w", err)
	}
	connectRequest.RequestID = strings.TrimSpace(connectRequest.RequestID)
	connectRequest.Channel.Kind = strings.TrimSpace(connectRequest.Channel.Kind)

	if connectRequest.Type != sessionprotocol.MessageTypeConnect {
		return sessionprotocol.AgentConnectRequest{}, fmt.Errorf("connect request type must be '%s'", sessionprotocol.MessageTypeConnect)
	}
	if connectRequest.V != sessionprotocol.ProtocolVersion {
		return sessionprotocol.AgentConnectRequest{}, fmt.Errorf("connect request protocol version must be %d", sessionprotocol.ProtocolVersion)
	}
	if connectRequest.RequestID == "" {
		return sessionprotocol.AgentConnectRequest{}, fmt.Errorf("connect request requestId is required")
	}
	if connectRequest.Channel.Kind == "" {
		return sessionprotocol.AgentConnectRequest{}, fmt.Errorf("connect request channel.kind is required")
	}

	return connectRequest, nil
}

func resolveAgentEndpoint(runtimeClients []startup.RuntimeClient) (*resolvedAgentEndpoint, error) {
	var agentEndpoint resolvedAgentEndpoint
	endpointCount := 0

	for _, runtimeClient := range runtimeClients {
		for _, endpoint := range runtimeClient.Endpoints {
			if endpoint.Transport.Type != "ws" {
				continue
			}

			endpointCount++
			agentEndpoint = resolvedAgentEndpoint{
				ClientID:       runtimeClient.ClientID,
				EndpointKey:    endpoint.EndpointKey,
				ConnectionMode: endpoint.ConnectionMode,
				TransportURL:   endpoint.Transport.URL,
			}
		}
	}

	if endpointCount == 0 {
		return nil, nil
	}
	if endpointCount > 1 {
		return nil, fmt.Errorf("runtime plan must declare at most one runtime client websocket endpoint for agent channel (found %d)", endpointCount)
	}

	return &agentEndpoint, nil
}

func dialAgentEndpoint(ctx context.Context, transportURL string) (*websocket.Conn, error) {
	dialContext, cancel := context.WithTimeout(ctx, agentEndpointDialTimeout)
	defer cancel()

	conn, _, err := websocket.Dial(dialContext, transportURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to dial websocket endpoint %s: %w", transportURL, err)
	}

	return conn, nil
}

func writeConnectOK(ctx context.Context, tunnelConn *websocket.Conn, connectOK sessionprotocol.ConnectOK) error {
	return writeTextJSONMessage(ctx, tunnelConn, connectOK)
}

func writeConnectError(ctx context.Context, tunnelConn *websocket.Conn, connectError sessionprotocol.ConnectError) error {
	return writeTextJSONMessage(ctx, tunnelConn, connectError)
}

func writeTextJSONMessage(ctx context.Context, tunnelConn *websocket.Conn, payload any) error {
	encodedPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to encode json payload: %w", err)
	}

	if err := tunnelConn.Write(ctx, websocket.MessageText, encodedPayload); err != nil {
		return fmt.Errorf("failed to write websocket message: %w", err)
	}

	return nil
}

func relayTunnelFrames(ctx context.Context, tunnelConn *websocket.Conn, agentConn *websocket.Conn) error {
	relayContext, cancel := context.WithCancel(ctx)
	defer cancel()

	relayErrCh := make(chan error, 2)

	go relayFramesDirection(relayContext, relayErrCh, tunnelConn, agentConn, "sandbox tunnel websocket", "agent websocket")
	go relayFramesDirection(relayContext, relayErrCh, agentConn, tunnelConn, "agent websocket", "sandbox tunnel websocket")

	relayErr := <-relayErrCh
	if relayErr != nil {
		return relayErr
	}

	return nil
}

func relayFramesDirection(
	ctx context.Context,
	relayErrCh chan<- error,
	source *websocket.Conn,
	target *websocket.Conn,
	sourceLabel string,
	targetLabel string,
) {
	for {
		messageType, payload, err := source.Read(ctx)
		if err != nil {
			relayErrCh <- fmt.Errorf("%s read failed: %w", sourceLabel, err)
			return
		}

		if messageType != websocket.MessageText && messageType != websocket.MessageBinary {
			relayErrCh <- fmt.Errorf("%s produced unsupported message type %s", sourceLabel, messageType.String())
			return
		}

		if err := target.Write(ctx, messageType, payload); err != nil {
			relayErrCh <- fmt.Errorf("%s write failed: %w", targetLabel, err)
			return
		}
	}
}
