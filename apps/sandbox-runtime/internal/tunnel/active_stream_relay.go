package tunnel

// activeTunnelStreamRelay owns one active interactive stream handler while the
// central tunnel loop in client.go routes messages by stream ID.
type activeTunnelStreamRelay struct {
	PrimaryStreamID int
	ChannelKind     string
	MessageCh       chan tunnelMessage
}

// activeTunnelStreamRelayResult reports relay completion back to the central
// tunnel loop and carries any PTY-session state updates that must outlive the
// relay itself.
type activeTunnelStreamRelayResult struct {
	Relay             *activeTunnelStreamRelay
	Err               error
	PTYSession        *ptySession
	UpdatesPTYSession bool
}

func finishActiveTunnelStreamRelay(
	activeRelaysByStreamID map[int]*activeTunnelStreamRelay,
	activePTYRelay **activeTunnelStreamRelay,
	activePTYSession **ptySession,
	result activeTunnelStreamRelayResult,
) error {
	for streamID, relay := range activeRelaysByStreamID {
		if relay != result.Relay {
			continue
		}

		delete(activeRelaysByStreamID, streamID)
	}
	if *activePTYRelay == result.Relay {
		*activePTYRelay = nil
	}
	if result.UpdatesPTYSession {
		*activePTYSession = result.PTYSession
	}
	return result.Err
}
