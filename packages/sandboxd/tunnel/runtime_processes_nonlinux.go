//go:build !linux

package tunnel

import tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"

func collectProcessEntries() ([]tunnelprotocol.ProcessEntry, error) {
	return nil, NewRuntimeProcessesError("sandboxd processes inventory is only supported in linux sandboxes")
}
