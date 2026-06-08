package tunnel

import (
	"fmt"

	"github.com/mistle/sandboxd/timeutil"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

type RuntimeProcessesError struct {
	message string
}

func NewRuntimeProcessesError(message string) RuntimeProcessesError {
	return RuntimeProcessesError{message: message}
}

func (err RuntimeProcessesError) Error() string {
	return err.message
}

func CollectProcessesSnapshot(clock timeutil.Clock) (tunnelprotocol.ProcessesSnapshot, error) {
	if clock == nil {
		return tunnelprotocol.ProcessesSnapshot{}, fmt.Errorf("processes snapshot clock is required")
	}
	processes, err := collectProcessEntries()
	if err != nil {
		return tunnelprotocol.ProcessesSnapshot{}, err
	}
	return tunnelprotocol.ProcessesSnapshot{
		MessageType: "processes.snapshot",
		ObservedAt:  timeutil.FormatRFC3339Timestamp(clock.NowSystemTime()),
		Processes:   processes,
	}, nil
}
