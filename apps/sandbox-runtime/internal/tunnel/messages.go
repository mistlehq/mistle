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
	ptyConnectErrorCodeInvalidSessionSelection = "invalid_pty_session_mode"
	streamResetCodeInvalidStreamSignal         = "invalid_stream_signal"
	streamResetCodeInvalidStreamClose          = "invalid_stream_close"
	streamResetCodeInvalidStreamData           = "invalid_stream_data"
	streamResetCodeInvalidStreamWindow         = "invalid_stream_window"
	streamResetCodeStreamCloseFailed           = "stream_close_failed"
	streamResetCodeTargetClosed                = "target_closed"
)

func writeStreamOpenOK(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	streamOpenOK sessionprotocol.StreamOpenOK,
) error {
	return writeTextJSONMessage(ctx, tunnelConn, streamOpenOK)
}

func writeStreamOpenError(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	streamOpenError sessionprotocol.StreamOpenError,
) error {
	return writeTextJSONMessage(ctx, tunnelConn, streamOpenError)
}

func writeStreamEvent(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	streamEvent sessionprotocol.StreamEvent,
) error {
	return writeTextJSONMessage(ctx, tunnelConn, streamEvent)
}

func writeStreamReset(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	streamReset sessionprotocol.StreamReset,
) error {
	return writeTextJSONMessage(ctx, tunnelConn, streamReset)
}

func writeStreamWindow(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	streamWindow sessionprotocol.StreamWindow,
) error {
	return writeTextJSONMessage(ctx, tunnelConn, streamWindow)
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

func writeBinaryDataFrame(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	streamID uint32,
	payloadKind byte,
	payload []byte,
) error {
	encodedPayload, err := sessionprotocol.EncodeDataFrame(struct {
		StreamID    uint32
		PayloadKind byte
		Payload     []byte
	}{
		StreamID:    streamID,
		PayloadKind: payloadKind,
		Payload:     payload,
	})
	if err != nil {
		return fmt.Errorf("failed to encode data frame: %w", err)
	}

	if err := tunnelConn.Write(ctx, websocket.MessageBinary, encodedPayload); err != nil {
		return fmt.Errorf("failed to write websocket message: %w", err)
	}

	return nil
}
