package protocol

import "fmt"

type KeepaliveMessageType string

const KeepaliveMessageState KeepaliveMessageType = "keepalive.state"

type KeepaliveState struct {
	MessageType KeepaliveMessageType `json:"type"`
	TTLMS       uint64               `json:"ttlMs"`
	Active      bool                 `json:"active"`
}

func DecodeKeepaliveState(data []byte) (KeepaliveState, error) {
	var state KeepaliveState
	if err := decodeStrict(data, &state); err != nil {
		return KeepaliveState{}, err
	}
	if state.MessageType != KeepaliveMessageState {
		return KeepaliveState{}, fmt.Errorf("unsupported keepalive message type: %s", state.MessageType)
	}
	return state, nil
}
