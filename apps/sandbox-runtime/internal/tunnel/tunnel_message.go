package tunnel

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

// tunnelMessage is one raw websocket message from the bootstrap tunnel.
type tunnelMessage struct {
	MessageType websocket.MessageType
	Payload     []byte
}

type tunnelReadResult struct {
	Message tunnelMessage
	Err     error
}

type tunnelMessageRouting struct {
	ControlMessageType string
	StreamID           int
}

func parseTunnelMessageRouting(message tunnelMessage) (tunnelMessageRouting, error) {
	if message.MessageType == websocket.MessageBinary {
		dataFrame, err := sessionprotocol.DecodeDataFrame(message.Payload)
		if err != nil {
			return tunnelMessageRouting{}, fmt.Errorf("stream data frame must be valid binary: %w", err)
		}

		return tunnelMessageRouting{
			StreamID: int(dataFrame.StreamID),
		}, nil
	}

	if message.MessageType != websocket.MessageText {
		return tunnelMessageRouting{}, fmt.Errorf(
			"unsupported sandbox tunnel websocket message type %s",
			message.MessageType.String(),
		)
	}

	var controlEnvelope struct {
		Type     string `json:"type"`
		StreamID int    `json:"streamId"`
	}
	if err := json.Unmarshal(message.Payload, &controlEnvelope); err != nil {
		return tunnelMessageRouting{}, fmt.Errorf("control message must be valid JSON: %w", err)
	}

	controlEnvelope.Type = strings.TrimSpace(controlEnvelope.Type)
	if controlEnvelope.Type == "" {
		return tunnelMessageRouting{}, fmt.Errorf("control message type is required")
	}
	if controlEnvelope.StreamID <= 0 {
		return tunnelMessageRouting{}, fmt.Errorf("control message streamId must be a positive integer")
	}

	return tunnelMessageRouting{
		ControlMessageType: controlEnvelope.Type,
		StreamID:           controlEnvelope.StreamID,
	}, nil
}

// readTunnelMessages keeps websocket reads in one place and forwards complete
// messages back to the central tunnel loop.
func readTunnelMessages(
	ctx context.Context,
	connection *websocket.Conn,
	resultCh chan<- tunnelReadResult,
) {
	for {
		messageType, payload, err := connection.Read(ctx)
		select {
		case resultCh <- tunnelReadResult{
			Message: tunnelMessage{
				MessageType: messageType,
				Payload:     payload,
			},
			Err: err,
		}:
		case <-ctx.Done():
			return
		}

		if err != nil {
			return
		}
	}
}
