package tunnel

import (
	"context"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type agentDetachedWorkObserver interface {
	SetTunnelConn(tunnelConn *websocket.Conn)
	ObserveClientMessage(messageType websocket.MessageType, payload []byte)
	ObserveAgentMessage(messageType websocket.MessageType, payload []byte)
}

type noopAgentDetachedWorkObserver struct{}

func (noopAgentDetachedWorkObserver) SetTunnelConn(_ *websocket.Conn) {}

func (noopAgentDetachedWorkObserver) ObserveClientMessage(
	_ websocket.MessageType,
	_ []byte,
) {
}

func (noopAgentDetachedWorkObserver) ObserveAgentMessage(
	_ websocket.MessageType,
	_ []byte,
) {
}

func newAgentDetachedWorkObserver(
	ctx context.Context,
	agentRuntimes []startup.AgentRuntime,
	runtimeClients []startup.RuntimeClient,
) (agentDetachedWorkObserver, error) {
	if len(agentRuntimes) != 1 {
		return noopAgentDetachedWorkObserver{}, nil
	}

	agentEndpoint, err := resolveAgentEndpoint(agentRuntimes, runtimeClients)
	if err != nil {
		return noopAgentDetachedWorkObserver{}, nil
	}
	if agentEndpoint == nil {
		return noopAgentDetachedWorkObserver{}, nil
	}

	if supportsCodexAgentDetachedWorkObserver(agentEndpoint.RuntimeKey) {
		return newCodexAgentDetachedWorkObserver(ctx, agentEndpoint), nil
	}

	return noopAgentDetachedWorkObserver{}, nil
}
