package tunnel

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/httpclient"
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

type agentRelayResult string

const (
	agentRelayResultDisconnected agentRelayResult = "disconnected"
)

func handleAgentConnectRequest(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	connectRequest connectRequest,
	agentRuntimes []startup.AgentRuntime,
	runtimeClients []startup.RuntimeClient,
) (*activeTunnelStreamRelay, error) {
	agentEndpoint, err := resolveAgentEndpoint(agentRuntimes, runtimeClients)
	if err != nil {
		if writeErr := writeStreamOpenError(ctx, tunnelConn, sessionprotocol.StreamOpenError{
			Type:     sessionprotocol.MessageTypeStreamOpenError,
			StreamID: connectRequest.StreamID,
			Code:     connectErrorCodeAgentEndpointUnavailable,
			Message:  err.Error(),
		}); writeErr != nil {
			return nil, fmt.Errorf("failed to write sandbox tunnel stream.open error: %w", writeErr)
		}
		return nil, nil
	}
	if agentEndpoint == nil {
		if writeErr := writeStreamOpenError(ctx, tunnelConn, sessionprotocol.StreamOpenError{
			Type:     sessionprotocol.MessageTypeStreamOpenError,
			StreamID: connectRequest.StreamID,
			Code:     connectErrorCodeAgentEndpointUnavailable,
			Message:  "agent endpoint is not declared in runtime plan",
		}); writeErr != nil {
			return nil, fmt.Errorf("failed to write sandbox tunnel stream.open error: %w", writeErr)
		}
		return nil, nil
	}

	if agentEndpoint.ConnectionMode != "dedicated" {
		if err := writeStreamOpenError(ctx, tunnelConn, sessionprotocol.StreamOpenError{
			Type:     sessionprotocol.MessageTypeStreamOpenError,
			StreamID: connectRequest.StreamID,
			Code:     connectErrorCodeUnsupportedConnectionMode,
			Message:  fmt.Sprintf("connection mode '%s' is not supported", agentEndpoint.ConnectionMode),
		}); err != nil {
			return nil, fmt.Errorf("failed to write sandbox tunnel stream.open error: %w", err)
		}
		return nil, nil
	}

	agentConn, err := dialAgentEndpoint(ctx, agentEndpoint.TransportURL)
	if err != nil {
		if writeErr := writeStreamOpenError(ctx, tunnelConn, sessionprotocol.StreamOpenError{
			Type:     sessionprotocol.MessageTypeStreamOpenError,
			StreamID: connectRequest.StreamID,
			Code:     connectErrorCodeAgentEndpointDialFailed,
			Message:  err.Error(),
		}); writeErr != nil {
			return nil, fmt.Errorf("failed to write sandbox tunnel stream.open error: %w", writeErr)
		}
		return nil, nil
	}

	if err := writeStreamOpenOK(ctx, tunnelConn, sessionprotocol.StreamOpenOK{
		Type:     sessionprotocol.MessageTypeStreamOpenOK,
		StreamID: connectRequest.StreamID,
	}); err != nil {
		agentConn.CloseNow()
		return nil, fmt.Errorf("failed to write sandbox tunnel stream.open acknowledgement: %w", err)
	}

	return startAgentRelay(ctx, tunnelConn, agentConn, connectRequest.StreamID), nil
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

	conn, _, err := websocket.Dial(dialContext, transportURL, &websocket.DialOptions{
		HTTPClient: httpclient.NewDirectClient(http.DefaultClient),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to dial websocket endpoint %s: %w", transportURL, err)
	}

	return conn, nil
}

func relayTunnelFrames(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	agentConn *websocket.Conn,
	streamID int,
	incomingMessages <-chan tunnelMessage,
) (agentRelayResult, error) {
	relayContext, cancelAgentRelay := context.WithCancel(ctx)
	defer cancelAgentRelay()

	agentRelayErrCh := make(chan error, 1)
	go relayFramesDirection(
		relayContext,
		agentRelayErrCh,
		agentConn,
		tunnelConn,
		"agent websocket",
		"sandbox tunnel websocket",
	)

	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case agentRelayErr := <-agentRelayErrCh:
			if agentRelayErr == nil || isExpectedAgentDisconnect(agentRelayErr) {
				return agentRelayResultDisconnected, nil
			}
			return "", agentRelayErr
		case message := <-incomingMessages:
			if message.MessageType != websocket.MessageText && message.MessageType != websocket.MessageBinary {
				return "", fmt.Errorf(
					"sandbox tunnel websocket produced unsupported message type %s",
					message.MessageType.String(),
				)
			}

			if message.MessageType == websocket.MessageText {
				controlMessageType, parseErr := parseControlMessageType(message.Payload)
				if parseErr == nil && controlMessageType == sessionprotocol.MessageTypeStreamClose {
					streamClose, closeErr := parseStreamClose(message.Payload)
					if closeErr != nil {
						return "", closeErr
					}
					if streamClose.StreamID != streamID {
						return "", fmt.Errorf(
							"stream.close streamId %d does not match active agent stream %d",
							streamClose.StreamID,
							streamID,
						)
					}
					return agentRelayResultDisconnected, nil
				}
			}

			if err := agentConn.Write(ctx, message.MessageType, message.Payload); err != nil {
				if isExpectedAgentDisconnect(err) {
					return agentRelayResultDisconnected, nil
				}
				return "", fmt.Errorf("agent websocket write failed: %w", err)
			}
		}
	}
}

func startAgentRelay(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	agentConn *websocket.Conn,
	streamID int,
) *activeTunnelStreamRelay {
	relay := &activeTunnelStreamRelay{
		MessageCh: make(chan tunnelMessage),
		ResultCh:  make(chan activeTunnelStreamRelayResult, 1),
	}

	go func() {
		defer agentConn.CloseNow()

		result := activeTunnelStreamRelayResult{}
		_, err := relayTunnelFrames(ctx, tunnelConn, agentConn, streamID, relay.MessageCh)
		if err != nil {
			result.Err = fmt.Errorf("sandbox tunnel websocket relay failed: %w", err)
		}
		relay.ResultCh <- result
	}()

	return relay
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

func isExpectedAgentDisconnect(err error) bool {
	if err == nil {
		return false
	}

	if errors.Is(err, context.Canceled) {
		return true
	}

	switch websocket.CloseStatus(err) {
	case websocket.StatusNormalClosure, websocket.StatusGoingAway:
		return true
	default:
		return false
	}
}
