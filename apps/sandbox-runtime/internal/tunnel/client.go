package tunnel

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/url"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/httpclient"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const bootstrapTokenQueryParam = "bootstrap_token"
const tunnelTracerName = "@mistle/sandbox-runtime"

type RunInput struct {
	Context        context.Context
	GatewayWSURL   string
	BootstrapToken []byte
	AgentRuntimes  []startup.AgentRuntime
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

	query := parsedGatewayURL.Query()
	query.Set(bootstrapTokenQueryParam, bootstrapToken)
	parsedGatewayURL.RawQuery = query.Encode()

	connectContext, connectSpan := tracer.Start(runContext, "sandbox.tunnel.connect")
	conn, _, err := websocket.Dial(connectContext, parsedGatewayURL.String(), &websocket.DialOptions{
		HTTPClient: httpclient.NewDirectClient(http.DefaultClient),
	})
	if err != nil {
		connectSpan.RecordError(err)
		connectSpan.SetStatus(codes.Error, err.Error())
		connectSpan.End()

		runSpan.RecordError(err)
		runSpan.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("failed to dial sandbox tunnel websocket: %w", err)
	}
	connectSpan.End()
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
		connectRequest, err := readConnectRequest(runContext, conn)
		if err != nil {
			if runContext.Err() != nil {
				return nil
			}
			runSpan.RecordError(err)
			runSpan.SetStatus(codes.Error, err.Error())
			return fmt.Errorf("sandbox tunnel websocket read failed: %w", err)
		}

		requestContext, requestSpan := tracer.Start(
			runContext,
			"sandbox.tunnel.connect_request",
			trace.WithAttributes(attribute.String("mistle.channel.kind", connectRequest.ChannelKind)),
		)

		switch connectRequest.ChannelKind {
		case sessionprotocol.ChannelKindAgent:
			err := handleAgentConnectRequest(
				requestContext,
				conn,
				connectRequest,
				input.AgentRuntimes,
				input.RuntimeClients,
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
		case sessionprotocol.ChannelKindPTY:
			updatedPTYSession, err := handlePTYConnectRequest(
				requestContext,
				conn,
				connectRequest,
				activePTYSession,
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
			activePTYSession = updatedPTYSession
		default:
			if err := writeConnectError(requestContext, conn, sessionprotocol.ConnectError{
				Type:      sessionprotocol.MessageTypeConnectError,
				RequestID: connectRequest.RequestID,
				Code:      connectErrorCodeUnsupportedChannel,
				Message:   fmt.Sprintf("channel kind '%s' is not supported", connectRequest.ChannelKind),
			}); err != nil {
				requestSpan.RecordError(err)
				requestSpan.SetStatus(codes.Error, err.Error())
				requestSpan.End()
				return fmt.Errorf("failed to write sandbox tunnel connect error: %w", err)
			}
		}

		requestSpan.End()
	}
}
