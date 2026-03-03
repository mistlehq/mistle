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
	Version     int
	RequestID   string
	ChannelKind string
	RawPayload  []byte
}

func readConnectRequest(ctx context.Context, tunnelConn *websocket.Conn) (connectRequest, error) {
	messageType, payload, err := tunnelConn.Read(ctx)
	if err != nil {
		return connectRequest{}, err
	}
	if messageType != websocket.MessageText {
		return connectRequest{}, fmt.Errorf(
			"expected connect request websocket text message, got %s",
			messageType.String(),
		)
	}

	var envelope struct {
		Type      string `json:"type"`
		V         int    `json:"v"`
		RequestID string `json:"requestId"`
		Channel   struct {
			Kind string `json:"kind"`
		} `json:"channel"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return connectRequest{}, fmt.Errorf("connect request must be valid JSON: %w", err)
	}

	envelope.Type = strings.TrimSpace(envelope.Type)
	envelope.RequestID = strings.TrimSpace(envelope.RequestID)
	envelope.Channel.Kind = strings.TrimSpace(envelope.Channel.Kind)

	if envelope.Type != sessionprotocol.MessageTypeConnect {
		return connectRequest{}, fmt.Errorf("connect request type must be '%s'", sessionprotocol.MessageTypeConnect)
	}
	if envelope.V != sessionprotocol.ProtocolVersion {
		return connectRequest{}, fmt.Errorf("connect request protocol version must be %d", sessionprotocol.ProtocolVersion)
	}
	if envelope.RequestID == "" {
		return connectRequest{}, fmt.Errorf("connect request requestId is required")
	}
	if envelope.Channel.Kind == "" {
		return connectRequest{}, fmt.Errorf("connect request channel.kind is required")
	}

	return connectRequest{
		Type:        envelope.Type,
		Version:     envelope.V,
		RequestID:   envelope.RequestID,
		ChannelKind: envelope.Channel.Kind,
		RawPayload:  payload,
	}, nil
}

func parsePTYConnectRequest(payload []byte) (sessionprotocol.PTYConnectRequest, error) {
	var connectRequest sessionprotocol.PTYConnectRequest
	if err := json.Unmarshal(payload, &connectRequest); err != nil {
		return sessionprotocol.PTYConnectRequest{}, fmt.Errorf("pty connect request must be valid JSON: %w", err)
	}

	connectRequest.Type = strings.TrimSpace(connectRequest.Type)
	connectRequest.RequestID = strings.TrimSpace(connectRequest.RequestID)
	connectRequest.Channel.Kind = strings.TrimSpace(connectRequest.Channel.Kind)
	connectRequest.Channel.Session = strings.TrimSpace(connectRequest.Channel.Session)
	connectRequest.Channel.Cwd = strings.TrimSpace(connectRequest.Channel.Cwd)

	if connectRequest.Type != sessionprotocol.MessageTypeConnect {
		return sessionprotocol.PTYConnectRequest{}, fmt.Errorf("pty connect request type must be '%s'", sessionprotocol.MessageTypeConnect)
	}
	if connectRequest.V != sessionprotocol.ProtocolVersion {
		return sessionprotocol.PTYConnectRequest{}, fmt.Errorf("pty connect request protocol version must be %d", sessionprotocol.ProtocolVersion)
	}
	if connectRequest.RequestID == "" {
		return sessionprotocol.PTYConnectRequest{}, fmt.Errorf("pty connect request requestId is required")
	}
	if connectRequest.Channel.Kind != sessionprotocol.ChannelKindPTY {
		return sessionprotocol.PTYConnectRequest{}, fmt.Errorf("pty connect request channel.kind must be '%s'", sessionprotocol.ChannelKindPTY)
	}
	if connectRequest.Channel.Session != sessionprotocol.PTYSessionModeCreate &&
		connectRequest.Channel.Session != sessionprotocol.PTYSessionModeAttach {
		return sessionprotocol.PTYConnectRequest{}, fmt.Errorf("%s '%s'", ptyConnectErrorCodeInvalidSessionSelection, connectRequest.Channel.Session)
	}
	if connectRequest.Channel.Cols < 0 || connectRequest.Channel.Rows < 0 {
		return sessionprotocol.PTYConnectRequest{}, fmt.Errorf("pty connect request cols and rows must be greater than or equal to 0")
	}
	if connectRequest.Channel.Cols > 65535 || connectRequest.Channel.Rows > 65535 {
		return sessionprotocol.PTYConnectRequest{}, fmt.Errorf("pty connect request cols and rows must be less than or equal to 65535")
	}
	if (connectRequest.Channel.Cols == 0) != (connectRequest.Channel.Rows == 0) {
		return sessionprotocol.PTYConnectRequest{}, fmt.Errorf("pty connect request cols and rows must both be provided when either is set")
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
