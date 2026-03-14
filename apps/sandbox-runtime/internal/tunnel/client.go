package tunnel

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/httpclient"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/telemetry"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const bootstrapTokenQueryParam = "bootstrap_token"
const tunnelTracerName = "@mistle/sandbox-runtime"

const (
	tunnelReconnectRetryDelayMin = time.Second
	tunnelReconnectRetryDelayMax = 30 * time.Second
)

type RunInput struct {
	Context             context.Context
	GatewayWSURL        string
	BootstrapToken      []byte
	TunnelExchangeToken string
	AgentRuntimes       []startup.AgentRuntime
	RuntimeClients      []startup.RuntimeClient
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

func nextTunnelReconnectDelay(attempt int) time.Duration {
	delay := tunnelReconnectRetryDelayMin
	for retryIndex := 1; retryIndex < attempt; retryIndex++ {
		if delay >= tunnelReconnectRetryDelayMax/2 {
			return tunnelReconnectRetryDelayMax
		}
		delay *= 2
	}

	return delay
}

func waitForTunnelReconnect(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer func() {
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
	}()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func dialSandboxTunnel(
	ctx context.Context,
	tracer trace.Tracer,
	gatewayWSURL string,
	httpClient *http.Client,
	bootstrapToken string,
) (*websocket.Conn, error) {
	parsedGatewayURL, err := parseGatewayURL(gatewayWSURL)
	if err != nil {
		return nil, err
	}
	query := parsedGatewayURL.Query()
	query.Set(bootstrapTokenQueryParam, bootstrapToken)
	parsedGatewayURL.RawQuery = query.Encode()

	connectContext, connectSpan := tracer.Start(ctx, "sandbox.tunnel.connect")
	defer connectSpan.End()

	conn, _, err := websocket.Dial(connectContext, parsedGatewayURL.String(), &websocket.DialOptions{
		HTTPClient: httpClient,
	})
	if err != nil {
		connectSpan.RecordError(err)
		connectSpan.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("failed to dial sandbox tunnel websocket: %w", err)
	}

	return conn, nil
}

func terminateActivePTYSession(activePTYSession **ptySession) {
	if *activePTYSession == nil || (*activePTYSession).IsExited() {
		*activePTYSession = nil
		return
	}

	_, _ = (*activePTYSession).Terminate()
	_ = (*activePTYSession).CloseTerminal()
	*activePTYSession = nil
}

func writeStreamAlreadyOpenError(
	ctx context.Context,
	conn *websocket.Conn,
	streamID int,
) error {
	return writeStreamOpenError(ctx, conn, sessionprotocol.StreamOpenError{
		Type:     sessionprotocol.MessageTypeStreamOpenError,
		StreamID: streamID,
		Code:     connectErrorCodeInvalidConnectRequest,
		Message:  fmt.Sprintf("stream %d is already open on the bootstrap tunnel", streamID),
	})
}

func writeUnboundStreamReset(
	ctx context.Context,
	conn *websocket.Conn,
	routing tunnelMessageRouting,
) error {
	resetCode := streamResetCodeInvalidStreamData
	switch routing.ControlMessageType {
	case sessionprotocol.MessageTypeStreamSignal:
		resetCode = streamResetCodeInvalidStreamSignal
	case sessionprotocol.MessageTypeStreamClose:
		resetCode = streamResetCodeInvalidStreamClose
	}

	return writeStreamReset(ctx, conn, sessionprotocol.StreamReset{
		Type:     sessionprotocol.MessageTypeStreamReset,
		StreamID: routing.StreamID,
		Code:     resetCode,
		Message:  fmt.Sprintf("stream %d is not open on the bootstrap tunnel", routing.StreamID),
	})
}

func handleSandboxTunnelConnection(
	runContext context.Context,
	tracer trace.Tracer,
	conn *websocket.Conn,
	activePTYSession **ptySession,
	agentRuntimes []startup.AgentRuntime,
	runtimeClients []startup.RuntimeClient,
	detachedWorkObserver agentDetachedWorkObserver,
) error {
	tunnelReadResultCh := make(chan tunnelReadResult, 1)
	relayResultCh := make(chan activeTunnelStreamRelayResult, 8)
	go readTunnelMessages(runContext, conn, tunnelReadResultCh)

	activeRelaysByStreamID := make(map[int]*activeTunnelStreamRelay)
	var activePTYRelay *activeTunnelStreamRelay

	for {
		select {
		case <-runContext.Done():
			return nil
		case activeRelayResult := <-relayResultCh:
			if err := finishActiveTunnelStreamRelay(
				activeRelaysByStreamID,
				&activePTYRelay,
				activePTYSession,
				activeRelayResult,
			); err != nil {
				if runContext.Err() != nil {
					return nil
				}
				return err
			}
		case tunnelReadResult := <-tunnelReadResultCh:
			if tunnelReadResult.Err != nil {
				if runContext.Err() != nil {
					return nil
				}
				return fmt.Errorf("sandbox tunnel websocket read failed: %w", tunnelReadResult.Err)
			}

			connectRequest, connectErr := parseConnectRequestMessage(
				tunnelReadResult.Message.MessageType,
				tunnelReadResult.Message.Payload,
			)
			if connectErr == nil {
				if _, exists := activeRelaysByStreamID[connectRequest.StreamID]; exists {
					if err := writeStreamAlreadyOpenError(runContext, conn, connectRequest.StreamID); err != nil {
						return fmt.Errorf("failed to write duplicate stream.open error: %w", err)
					}
					continue
				}

				if connectRequest.ChannelKind == sessionprotocol.ChannelKindPTY && activePTYRelay != nil {
					ptyConnectRequest, err := parsePTYConnectRequest(connectRequest.RawPayload)
					if err != nil {
						if writeErr := writeStreamOpenError(runContext, conn, sessionprotocol.StreamOpenError{
							Type:     sessionprotocol.MessageTypeStreamOpenError,
							StreamID: connectRequest.StreamID,
							Code:     connectErrorCodeInvalidConnectRequest,
							Message:  err.Error(),
						}); writeErr != nil {
							return fmt.Errorf("failed to write sandbox tunnel stream.open error: %w", writeErr)
						}
						continue
					}

					if ptyConnectRequest.Channel.Session == sessionprotocol.PTYSessionModeAttach {
						activeRelaysByStreamID[connectRequest.StreamID] = activePTYRelay
					}

					select {
					case activePTYRelay.MessageCh <- tunnelReadResult.Message:
						continue
					case activeRelayResult := <-relayResultCh:
						if err := finishActiveTunnelStreamRelay(
							activeRelaysByStreamID,
							&activePTYRelay,
							activePTYSession,
							activeRelayResult,
						); err != nil {
							if runContext.Err() != nil {
								return nil
							}
							return err
						}
						continue
					case <-runContext.Done():
						return nil
					}
				}

				requestContext, requestSpan := tracer.Start(
					runContext,
					"sandbox.tunnel.stream_open",
					trace.WithAttributes(attribute.String("mistle.channel.kind", connectRequest.ChannelKind)),
				)

				switch connectRequest.ChannelKind {
				case sessionprotocol.ChannelKindAgent:
					relay, err := handleAgentConnectRequest(
						requestContext,
						conn,
						connectRequest,
						agentRuntimes,
						runtimeClients,
						detachedWorkObserver,
						relayResultCh,
					)
					if err != nil {
						requestSpan.RecordError(err)
						requestSpan.SetStatus(codes.Error, err.Error())
						requestSpan.End()

						if runContext.Err() != nil {
							return nil
						}
						return err
					}
					if relay != nil {
						activeRelaysByStreamID[connectRequest.StreamID] = relay
					}
				case sessionprotocol.ChannelKindPTY:
					updatedPTYSession, relay, err := handlePTYConnectRequest(
						requestContext,
						conn,
						connectRequest,
						*activePTYSession,
						relayResultCh,
					)
					if err != nil {
						requestSpan.RecordError(err)
						requestSpan.SetStatus(codes.Error, err.Error())
						requestSpan.End()

						if runContext.Err() != nil {
							return nil
						}
						return err
					}
					*activePTYSession = updatedPTYSession
					if relay != nil {
						activePTYRelay = relay
						activeRelaysByStreamID[connectRequest.StreamID] = relay
					}
				default:
					if err := writeStreamOpenError(requestContext, conn, sessionprotocol.StreamOpenError{
						Type:     sessionprotocol.MessageTypeStreamOpenError,
						StreamID: connectRequest.StreamID,
						Code:     connectErrorCodeUnsupportedChannel,
						Message:  fmt.Sprintf("channel kind '%s' is not supported", connectRequest.ChannelKind),
					}); err != nil {
						requestSpan.RecordError(err)
						requestSpan.SetStatus(codes.Error, err.Error())
						requestSpan.End()
						return fmt.Errorf("failed to write sandbox tunnel stream.open error: %w", err)
					}
				}

				requestSpan.End()
				continue
			}

			routing, err := parseTunnelMessageRouting(tunnelReadResult.Message)
			if err != nil {
				return fmt.Errorf("sandbox tunnel websocket read failed: %w", err)
			}

			relay := activeRelaysByStreamID[routing.StreamID]
			if relay == nil {
				if err := writeUnboundStreamReset(runContext, conn, routing); err != nil {
					return fmt.Errorf("failed to write stream.reset for unknown stream: %w", err)
				}
				continue
			}

			releasePTYAttachBinding := routing.ControlMessageType == sessionprotocol.MessageTypeStreamClose &&
				relay.ChannelKind == sessionprotocol.ChannelKindPTY &&
				routing.StreamID != relay.PrimaryStreamID

			select {
			case relay.MessageCh <- tunnelReadResult.Message:
				if releasePTYAttachBinding {
					delete(activeRelaysByStreamID, routing.StreamID)
				}
			case activeRelayResult := <-relayResultCh:
				if err := finishActiveTunnelStreamRelay(
					activeRelaysByStreamID,
					&activePTYRelay,
					activePTYSession,
					activeRelayResult,
				); err != nil {
					if runContext.Err() != nil {
						return nil
					}
					return err
				}
			case <-runContext.Done():
				return nil
			}
		}
	}
}

func Run(input RunInput) error {
	if input.Context == nil {
		return fmt.Errorf("sandbox tunnel context is required")
	}
	tracer := otel.Tracer(tunnelTracerName)

	runContext, runSpan := tracer.Start(input.Context, "sandbox.tunnel.loop")
	defer runSpan.End()

	parsedGatewayURL, err := parseGatewayURL(input.GatewayWSURL)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return err
	}
	runSpan.SetAttributes(
		attribute.String("server.address", parsedGatewayURL.Host),
		attribute.String("url.path", parsedGatewayURL.Path),
	)

	bootstrapToken, err := normalizeBootstrapToken(input.BootstrapToken)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return err
	}
	tunnelTokens, err := newTunnelTokens(bootstrapToken, input.TunnelExchangeToken)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return err
	}

	dialHTTPClient := httpclient.NewDirectClient(http.DefaultClient)
	tokenExchangeHTTPClient := telemetry.NewHTTPClient(httpclient.NewDirectClient(http.DefaultClient))
	detachedWorkObserver, err := newAgentDetachedWorkObserver(
		runContext,
		input.AgentRuntimes,
		input.RuntimeClients,
	)
	if err != nil {
		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return err
	}
	tokenExchangeContext, cancelTokenExchange := context.WithCancel(runContext)
	defer cancelTokenExchange()

	go func() {
		tokenExchangeContext, tokenExchangeSpan := tracer.Start(
			tokenExchangeContext,
			"sandbox.tunnel.token_exchange_loop",
		)
		defer tokenExchangeSpan.End()

		tokenExchangeErr := runTunnelTokenExchangeLoop(tunnelTokenExchangeLoopInput{
			Context:      tokenExchangeContext,
			GatewayWSURL: input.GatewayWSURL,
			HTTPClient:   tokenExchangeHTTPClient,
			Tokens:       tunnelTokens,
		})
		if tokenExchangeErr != nil {
			tokenExchangeSpan.RecordError(tokenExchangeErr)
			tokenExchangeSpan.SetStatus(codes.Error, tokenExchangeErr.Error())
		}
	}()

	var activePTYSession *ptySession
	defer terminateActivePTYSession(&activePTYSession)

	for dialAttempt := 1; ; dialAttempt++ {
		if dialAttempt > 1 {
			if exchangeErr := exchangeTunnelTokensNow(runContext, tokenExchangeHTTPClient, input.GatewayWSURL, tunnelTokens); exchangeErr != nil {
				if runContext.Err() != nil {
					return nil
				}
				if !shouldRetryTunnelTokenExchange(exchangeErr) {
					runSpan.RecordError(exchangeErr)
					runSpan.SetStatus(codes.Error, exchangeErr.Error())
					return fmt.Errorf("sandbox tunnel reconnect token exchange failed: %w", exchangeErr)
				}
				if waitErr := waitForTunnelReconnect(runContext, nextTunnelReconnectDelay(dialAttempt-1)); waitErr != nil {
					return nil
				}
				continue
			}
		}

		conn, dialErr := dialSandboxTunnel(
			runContext,
			tracer,
			input.GatewayWSURL,
			dialHTTPClient,
			tunnelTokens.CurrentBootstrapToken(),
		)
		if dialErr != nil {
			if runContext.Err() != nil {
				return nil
			}
			if waitErr := waitForTunnelReconnect(runContext, nextTunnelReconnectDelay(dialAttempt)); waitErr != nil {
				return nil
			}
			continue
		}

		detachedWorkObserver.SetTunnelConn(conn)
		connectionErr := handleSandboxTunnelConnection(
			runContext,
			tracer,
			conn,
			&activePTYSession,
			input.AgentRuntimes,
			input.RuntimeClients,
			detachedWorkObserver,
		)
		detachedWorkObserver.SetTunnelConn(nil)
		conn.CloseNow()
		if connectionErr == nil {
			return nil
		}
		if runContext.Err() != nil {
			return nil
		}
		terminateActivePTYSession(&activePTYSession)
	}
}
