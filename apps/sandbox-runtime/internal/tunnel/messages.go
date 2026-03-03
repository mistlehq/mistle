package tunnel

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

const (
	connectErrorCodeUnsupportedChannel         = "unsupported_channel"
	connectErrorCodeInvalidConnectRequest      = "invalid_connect_request"
	connectErrorCodeAgentEndpointUnavailable   = "agent_endpoint_unavailable"
	connectErrorCodeUnsupportedConnectionMode  = "unsupported_connection_mode"
	connectErrorCodeAgentEndpointDialFailed    = "agent_endpoint_dial_failed"
	connectErrorCodePTYSessionUnavailable      = "pty_session_unavailable"
	connectErrorCodePTYSessionExists           = "pty_session_exists"
	connectErrorCodePTYSessionCreateFailed     = "pty_session_create_failed"
	ptyCloseErrorCodeTerminateFailed           = "pty_terminate_failed"
	ptyCloseErrorCodeInvalidCloseRequest       = "invalid_pty_close_request"
	ptyConnectErrorCodeInvalidSessionSelection = "invalid_pty_session_mode"
)

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
