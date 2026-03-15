package tunnel

import (
	"context"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type agentExecutionLeaseObserver interface {
	ObserveClientMessage(payload []byte)
	ObserveAgentMessage(payload []byte)
	HandleStreamDisconnected()
}

type agentExecutionLeaseObserverInput struct {
	Context         context.Context
	AgentRuntime    startup.AgentRuntime
	TransportURL    string
	ExecutionLeases *executionLeaseEngine
}

func newAgentExecutionLeaseObserver(
	input agentExecutionLeaseObserverInput,
) agentExecutionLeaseObserver {
	if input.AgentRuntime.RuntimeKey == codexAgentRuntimeKey {
		return newCodexExecutionLeaseObserver(codexExecutionLeaseObserverInput{
			Context:         input.Context,
			TransportURL:    input.TransportURL,
			ExecutionLeases: input.ExecutionLeases,
			PollInterval:    defaultCodexExecutionLeasePollInterval,
		})
	}

	return nil
}
