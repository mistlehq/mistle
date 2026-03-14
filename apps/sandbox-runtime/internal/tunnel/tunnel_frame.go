package tunnel

import (
	"context"
	"fmt"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

type tunnelFrame struct {
	MessageType websocket.MessageType
	Payload     []byte
	DataFrame   *sessionprotocol.StreamDataFrame
}

func readTunnelFrame(ctx context.Context, tunnelConn *websocket.Conn) (tunnelFrame, error) {
	messageType, payload, err := tunnelConn.Read(ctx)
	if err != nil {
		return tunnelFrame{}, err
	}

	if messageType != websocket.MessageText && messageType != websocket.MessageBinary {
		return tunnelFrame{}, fmt.Errorf("unsupported websocket message type: %s", messageType.String())
	}

	frame := tunnelFrame{
		MessageType: messageType,
		Payload:     payload,
	}
	if messageType != websocket.MessageBinary {
		return frame, nil
	}

	dataFrame, err := sessionprotocol.DecodeDataFrame(payload)
	if err != nil {
		return tunnelFrame{}, fmt.Errorf("failed to decode stream data frame: %w", err)
	}
	frame.DataFrame = &dataFrame
	return frame, nil
}
