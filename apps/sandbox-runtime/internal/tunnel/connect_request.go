package tunnel

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

type connectRequest struct {
	Type        string
	StreamID    int
	ChannelKind string
	RawPayload  []byte
}

func parseConnectRequestMessage(messageType websocket.MessageType, payload []byte) (connectRequest, error) {
	if messageType != websocket.MessageText {
		return connectRequest{}, fmt.Errorf(
			"expected connect request websocket text message, got %s",
			messageType.String(),
		)
	}

	var envelope struct {
		Type     string `json:"type"`
		StreamID int    `json:"streamId"`
		Channel  struct {
			Kind string `json:"kind"`
		} `json:"channel"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return connectRequest{}, fmt.Errorf("stream.open request must be valid JSON: %w", err)
	}

	envelope.Type = strings.TrimSpace(envelope.Type)
	envelope.Channel.Kind = strings.TrimSpace(envelope.Channel.Kind)

	if envelope.Type != sessionprotocol.MessageTypeStreamOpen {
		return connectRequest{}, fmt.Errorf("stream.open request type must be '%s'", sessionprotocol.MessageTypeStreamOpen)
	}
	if envelope.StreamID <= 0 {
		return connectRequest{}, fmt.Errorf("stream.open request streamId must be a positive integer")
	}
	if envelope.Channel.Kind == "" {
		return connectRequest{}, fmt.Errorf("stream.open request channel.kind is required")
	}

	return connectRequest{
		Type:        envelope.Type,
		StreamID:    envelope.StreamID,
		ChannelKind: envelope.Channel.Kind,
		RawPayload:  payload,
	}, nil
}

func readConnectRequest(ctx context.Context, tunnelConn *websocket.Conn) (connectRequest, error) {
	messageType, payload, err := tunnelConn.Read(ctx)
	if err != nil {
		return connectRequest{}, err
	}

	return parseConnectRequestMessage(messageType, payload)
}

func parsePTYConnectRequest(payload []byte) (sessionprotocol.StreamOpen, error) {
	var connectRequest sessionprotocol.StreamOpen
	if err := json.Unmarshal(payload, &connectRequest); err != nil {
		return sessionprotocol.StreamOpen{}, fmt.Errorf("pty stream.open request must be valid JSON: %w", err)
	}

	connectRequest.Type = strings.TrimSpace(connectRequest.Type)
	connectRequest.Channel.Kind = strings.TrimSpace(connectRequest.Channel.Kind)
	connectRequest.Channel.Session = strings.TrimSpace(connectRequest.Channel.Session)
	connectRequest.Channel.Cwd = strings.TrimSpace(connectRequest.Channel.Cwd)

	if connectRequest.Type != sessionprotocol.MessageTypeStreamOpen {
		return sessionprotocol.StreamOpen{}, fmt.Errorf("pty stream.open request type must be '%s'", sessionprotocol.MessageTypeStreamOpen)
	}
	if connectRequest.StreamID <= 0 {
		return sessionprotocol.StreamOpen{}, fmt.Errorf("pty stream.open request streamId must be a positive integer")
	}
	if connectRequest.Channel.Kind != sessionprotocol.ChannelKindPTY {
		return sessionprotocol.StreamOpen{}, fmt.Errorf("pty stream.open request channel.kind must be '%s'", sessionprotocol.ChannelKindPTY)
	}
	if connectRequest.Channel.Session != sessionprotocol.PTYSessionModeCreate &&
		connectRequest.Channel.Session != sessionprotocol.PTYSessionModeAttach {
		return sessionprotocol.StreamOpen{}, fmt.Errorf("%s '%s'", ptyConnectErrorCodeInvalidSessionSelection, connectRequest.Channel.Session)
	}
	if connectRequest.Channel.Cols < 0 || connectRequest.Channel.Rows < 0 {
		return sessionprotocol.StreamOpen{}, fmt.Errorf("pty stream.open request cols and rows must be greater than or equal to 0")
	}
	if connectRequest.Channel.Cols > 65535 || connectRequest.Channel.Rows > 65535 {
		return sessionprotocol.StreamOpen{}, fmt.Errorf("pty stream.open request cols and rows must be less than or equal to 65535")
	}
	if (connectRequest.Channel.Cols == 0) != (connectRequest.Channel.Rows == 0) {
		return sessionprotocol.StreamOpen{}, fmt.Errorf("pty stream.open request cols and rows must both be provided when either is set")
	}

	return connectRequest, nil
}

func parseControlMessageType(payload []byte) (string, error) {
	var message struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(payload, &message); err != nil {
		return "", err
	}

	message.Type = strings.TrimSpace(message.Type)
	if message.Type == "" {
		return "", fmt.Errorf("control message type is required")
	}

	return message.Type, nil
}
