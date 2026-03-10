package tunnel

import (
	"context"
	"fmt"
	"time"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

const agentEndpointDialTimeout = 5 * time.Second

type resolvedAgentEndpoint struct {
	ClientID       string
	EndpointKey    string
	ConnectionMode string
	TransportURL   string
}

func handleAgentConnectRequest(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	connectRequest connectRequest,
	agentRuntimes []startup.AgentRuntime,
	runtimeClients []startup.RuntimeClient,
) error {
	agentEndpoint, err := resolveAgentEndpoint(agentRuntimes, runtimeClients)
	if err != nil {
		if writeErr := writeConnectError(ctx, tunnelConn, sessionprotocol.ConnectError{
			Type:      sessionprotocol.MessageTypeConnectError,
			RequestID: connectRequest.RequestID,
			Code:      connectErrorCodeAgentEndpointUnavailable,
			Message:   err.Error(),
		}); writeErr != nil {
			return fmt.Errorf("failed to write sandbox tunnel connect error: %w", writeErr)
		}
		return nil
	}
	if agentEndpoint == nil {
		if writeErr := writeConnectError(ctx, tunnelConn, sessionprotocol.ConnectError{
			Type:      sessionprotocol.MessageTypeConnectError,
			RequestID: connectRequest.RequestID,
			Code:      connectErrorCodeAgentEndpointUnavailable,
			Message:   "agent endpoint is not declared in runtime plan",
		}); writeErr != nil {
			return fmt.Errorf("failed to write sandbox tunnel connect error: %w", writeErr)
		}
		return nil
	}

	if agentEndpoint.ConnectionMode != "dedicated" {
		if err := writeConnectError(ctx, tunnelConn, sessionprotocol.ConnectError{
			Type:      sessionprotocol.MessageTypeConnectError,
			RequestID: connectRequest.RequestID,
			Code:      connectErrorCodeUnsupportedConnectionMode,
			Message:   fmt.Sprintf("connection mode '%s' is not supported", agentEndpoint.ConnectionMode),
		}); err != nil {
			return fmt.Errorf("failed to write sandbox tunnel connect error: %w", err)
		}
		return nil
	}

	agentConn, err := dialAgentEndpoint(ctx, agentEndpoint.TransportURL)
	if err != nil {
		if writeErr := writeConnectError(ctx, tunnelConn, sessionprotocol.ConnectError{
			Type:      sessionprotocol.MessageTypeConnectError,
			RequestID: connectRequest.RequestID,
			Code:      connectErrorCodeAgentEndpointDialFailed,
			Message:   err.Error(),
		}); writeErr != nil {
			return fmt.Errorf("failed to write sandbox tunnel connect error: %w", writeErr)
		}
		return nil
	}
	defer agentConn.CloseNow()

	if err := writeConnectOK(ctx, tunnelConn, sessionprotocol.ConnectOK{
		Type:      sessionprotocol.MessageTypeConnectOK,
		RequestID: connectRequest.RequestID,
	}); err != nil {
		return fmt.Errorf("failed to write sandbox tunnel connect acknowledgement: %w", err)
	}

	if err := relayTunnelFrames(ctx, tunnelConn, agentConn); err != nil {
		return fmt.Errorf("sandbox tunnel websocket relay failed: %w", err)
	}

	return nil
}

func resolveAgentEndpoint(
	agentRuntimes []startup.AgentRuntime,
	runtimeClients []startup.RuntimeClient,
) (*resolvedAgentEndpoint, error) {
	if len(agentRuntimes) == 0 {
		return nil, nil
	}
	if len(agentRuntimes) > 1 {
		return nil, fmt.Errorf("runtime plan must declare at most one agent runtime for agent channel (found %d)", len(agentRuntimes))
	}

	agentRuntime := agentRuntimes[0]
	for _, runtimeClient := range runtimeClients {
		if runtimeClient.ClientID != agentRuntime.ClientID {
			continue
		}

		for _, endpoint := range runtimeClient.Endpoints {
			if endpoint.EndpointKey != agentRuntime.EndpointKey {
				continue
			}
			if endpoint.Transport.Type != "ws" {
				return nil, fmt.Errorf(
					"agent runtime '%s' on client '%s' must reference a websocket endpoint",
					agentRuntime.RuntimeKey,
					agentRuntime.ClientID,
				)
			}

			return &resolvedAgentEndpoint{
				ClientID:       runtimeClient.ClientID,
				EndpointKey:    endpoint.EndpointKey,
				ConnectionMode: endpoint.ConnectionMode,
				TransportURL:   endpoint.Transport.URL,
			}, nil
		}

		return nil, fmt.Errorf(
			"agent runtime '%s' references missing endpoint '%s' on client '%s'",
			agentRuntime.RuntimeKey,
			agentRuntime.EndpointKey,
			agentRuntime.ClientID,
		)
	}

	return nil, fmt.Errorf(
		"agent runtime '%s' references missing runtime client '%s'",
		agentRuntime.RuntimeKey,
		agentRuntime.ClientID,
	)
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
