package tunnel

import (
	"context"

	"github.com/coder/websocket"
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
