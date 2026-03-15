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
	RuntimeKey     string
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
	executionLeases *executionLeaseEngine,
	agentRuntimes []startup.AgentRuntime,
	runtimeClients []startup.RuntimeClient,
	relayResultCh chan<- activeTunnelStreamRelayResult,
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

	observer := newAgentExecutionLeaseObserver(agentExecutionLeaseObserverInput{
		Context:         ctx,
		AgentRuntime:    startup.AgentRuntime{RuntimeKey: agentEndpoint.RuntimeKey},
		TransportURL:    agentEndpoint.TransportURL,
		ExecutionLeases: executionLeases,
	})

	return startAgentRelay(
		ctx,
		tunnelConn,
		agentConn,
		connectRequest.StreamID,
		observer,
		relayResultCh,
	), nil
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
				RuntimeKey:     agentRuntime.RuntimeKey,
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
	observer agentExecutionLeaseObserver,
	incomingMessages <-chan tunnelMessage,
) (agentRelayResult, error) {
	relayContext, cancelAgentRelay := context.WithCancel(ctx)
	defer cancelAgentRelay()
	sendWindow := newStreamSendWindow()

	agentRelayErrCh := make(chan error, 1)
	go relayAgentFramesDirection(
		relayContext,
		agentRelayErrCh,
		agentConn,
		sendWindow,
		tunnelConn,
		uint32(streamID),
		observer,
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
			if message.MessageType == websocket.MessageText {
				controlMessageType, parseErr := parseControlMessageType(message.Payload)
				if parseErr == nil && controlMessageType == sessionprotocol.MessageTypeStreamWindow {
					streamWindow, windowErr := parseStreamWindow(message.Payload)
					if windowErr != nil {
						return "", windowErr
					}
					if streamWindow.StreamID != streamID {
						return "", fmt.Errorf(
							"stream.window streamId %d does not match active agent stream %d",
							streamWindow.StreamID,
							streamID,
						)
					}
					if err := sendWindow.add(streamWindow.Bytes); err != nil {
						if writeErr := writeStreamReset(relayContext, tunnelConn, sessionprotocol.StreamReset{
							Type:     sessionprotocol.MessageTypeStreamReset,
							StreamID: streamID,
							Code:     streamResetCodeInvalidStreamWindow,
							Message:  err.Error(),
						}); writeErr != nil {
							return "", fmt.Errorf("failed to write stream.reset for excessive agent stream.window: %w", writeErr)
						}
						return agentRelayResultDisconnected, nil
					}
					continue
				}
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

				if err := writeStreamReset(relayContext, tunnelConn, sessionprotocol.StreamReset{
					Type:     sessionprotocol.MessageTypeStreamReset,
					StreamID: streamID,
					Code:     streamResetCodeInvalidStreamData,
					Message:  "agent stream only accepts binary data frames after stream.open",
				}); err != nil {
					return "", fmt.Errorf("failed to write stream.reset for invalid agent text payload: %w", err)
				}
				return agentRelayResultDisconnected, nil
			}

			if message.MessageType != websocket.MessageBinary {
				return "", fmt.Errorf(
					"sandbox tunnel websocket produced unsupported message type %s",
					message.MessageType.String(),
				)
			}

			dataFrame, err := sessionprotocol.DecodeDataFrame(message.Payload)
			if err != nil {
				if writeErr := writeStreamReset(relayContext, tunnelConn, sessionprotocol.StreamReset{
					Type:     sessionprotocol.MessageTypeStreamReset,
					StreamID: streamID,
					Code:     streamResetCodeInvalidStreamData,
					Message:  err.Error(),
				}); writeErr != nil {
					return "", fmt.Errorf("failed to write stream.reset for invalid agent data frame: %w", writeErr)
				}
				return agentRelayResultDisconnected, nil
			}
			if dataFrame.StreamID != uint32(streamID) {
				if err := writeStreamReset(relayContext, tunnelConn, sessionprotocol.StreamReset{
					Type:     sessionprotocol.MessageTypeStreamReset,
					StreamID: streamID,
					Code:     streamResetCodeInvalidStreamData,
					Message:  fmt.Sprintf("stream data frame streamId %d does not match active agent stream %d", dataFrame.StreamID, streamID),
				}); err != nil {
					return "", fmt.Errorf("failed to write stream.reset for mismatched agent data frame: %w", err)
				}
				return agentRelayResultDisconnected, nil
			}

			var agentMessageType websocket.MessageType
			switch dataFrame.PayloadKind {
			case sessionprotocol.PayloadKindWebSocketText:
				agentMessageType = websocket.MessageText
			case sessionprotocol.PayloadKindWebSocketBinary:
				agentMessageType = websocket.MessageBinary
			default:
				if err := writeStreamReset(relayContext, tunnelConn, sessionprotocol.StreamReset{
					Type:     sessionprotocol.MessageTypeStreamReset,
					StreamID: streamID,
					Code:     streamResetCodeInvalidStreamData,
					Message:  fmt.Sprintf("agent stream payloadKind %d is not supported", dataFrame.PayloadKind),
				}); err != nil {
					return "", fmt.Errorf("failed to write stream.reset for unsupported agent payload kind: %w", err)
				}
				return agentRelayResultDisconnected, nil
			}

			if err := agentConn.Write(ctx, agentMessageType, dataFrame.Payload); err != nil {
				if isExpectedAgentDisconnect(err) {
					return agentRelayResultDisconnected, nil
				}
				return "", fmt.Errorf("agent websocket write failed: %w", err)
			}
			if agentMessageType == websocket.MessageText && observer != nil {
				observer.ObserveClientMessage(dataFrame.Payload)
			}
			if err := writeStreamWindow(relayContext, tunnelConn, sessionprotocol.StreamWindow{
				Type:     sessionprotocol.MessageTypeStreamWindow,
				StreamID: streamID,
				Bytes:    len(dataFrame.Payload),
			}); err != nil {
				return "", fmt.Errorf("failed to write stream.window for consumed agent data: %w", err)
			}
		}
	}
}

func startAgentRelay(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	agentConn *websocket.Conn,
	streamID int,
	observer agentExecutionLeaseObserver,
	relayResultCh chan<- activeTunnelStreamRelayResult,
) *activeTunnelStreamRelay {
	relay := &activeTunnelStreamRelay{
		PrimaryStreamID: streamID,
		ChannelKind:     sessionprotocol.ChannelKindAgent,
		MessageCh:       make(chan tunnelMessage),
	}

	go func() {
		defer agentConn.CloseNow()

		result := activeTunnelStreamRelayResult{
			Relay: relay,
		}
		relayResult, err := relayTunnelFrames(ctx, tunnelConn, agentConn, streamID, observer, relay.MessageCh)
		if err != nil {
			result.Err = fmt.Errorf("sandbox tunnel websocket relay failed: %w", err)
		} else if relayResult == agentRelayResultDisconnected && observer != nil {
			observer.HandleStreamDisconnected()
		}
		relayResultCh <- result
	}()

	return relay
}

func relayAgentFramesDirection(
	ctx context.Context,
	relayErrCh chan<- error,
	source *websocket.Conn,
	sendWindow *streamSendWindow,
	target *websocket.Conn,
	streamID uint32,
	observer agentExecutionLeaseObserver,
) {
	for {
		messageType, payload, err := source.Read(ctx)
		if err != nil {
			relayErrCh <- fmt.Errorf("agent websocket read failed: %w", err)
			return
		}

		if messageType != websocket.MessageText && messageType != websocket.MessageBinary {
			relayErrCh <- fmt.Errorf("agent websocket produced unsupported message type %s", messageType.String())
			return
		}

		if !sendWindow.tryConsume(len(payload)) {
			if writeErr := writeStreamReset(ctx, target, sessionprotocol.StreamReset{
				Type:     sessionprotocol.MessageTypeStreamReset,
				StreamID: int(streamID),
				Code:     streamResetCodeStreamWindowExhausted,
				Message:  "agent stream send window is exhausted",
			}); writeErr != nil {
				relayErrCh <- fmt.Errorf("failed to write stream.reset for exhausted agent send window: %w", writeErr)
				return
			}
			relayErrCh <- nil
			return
		}

		var payloadKind byte
		switch messageType {
		case websocket.MessageText:
			payloadKind = sessionprotocol.PayloadKindWebSocketText
			if observer != nil {
				observer.ObserveAgentMessage(payload)
			}
		case websocket.MessageBinary:
			payloadKind = sessionprotocol.PayloadKindWebSocketBinary
		default:
			relayErrCh <- fmt.Errorf("agent websocket produced unsupported message type %s", messageType.String())
			return
		}

		if err := writeBinaryDataFrame(ctx, target, streamID, payloadKind, payload); err != nil {
			relayErrCh <- fmt.Errorf("sandbox tunnel websocket write failed: %w", err)
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
