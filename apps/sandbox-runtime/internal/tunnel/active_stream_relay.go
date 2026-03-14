package tunnel

// activeTunnelStreamRelay owns one active interactive stream while the tunnel
// read loop remains centralized in client.go.
type activeTunnelStreamRelay struct {
	MessageCh chan tunnelMessage
	ResultCh  chan activeTunnelStreamRelayResult
}

// activeTunnelStreamRelayResult reports stream completion back to the central
// tunnel loop and carries any PTY-session state updates that must outlive the
// stream itself.
type activeTunnelStreamRelayResult struct {
	Err               error
	PTYSession        *ptySession
	UpdatesPTYSession bool
}

func finishActiveTunnelStreamRelay(
	activeRelay **activeTunnelStreamRelay,
	activePTYSession **ptySession,
	result activeTunnelStreamRelayResult,
) error {
	*activeRelay = nil
	if result.UpdatesPTYSession {
		*activePTYSession = result.PTYSession
	}
	return result.Err
}
