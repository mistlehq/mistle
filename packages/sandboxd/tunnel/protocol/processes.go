package protocol

import (
	"encoding/json"
	"fmt"
)

const (
	ConnectErrorCodeProcessesStreamUnavailable = "processes_stream_unavailable"
	StreamResetCodeProcessesSnapshotFailed     = "processes_snapshot_failed"
)

type ProcessListener struct {
	Port        uint16 `json:"port"`
	BindAddress string `json:"bindAddress"`
}

type ProcessEntry struct {
	PID       uint32            `json:"pid"`
	Command   *string           `json:"command"`
	Listeners []ProcessListener `json:"listeners"`
}

type ProcessesRefresh struct {
	MessageType string `json:"type"`
}

type ProcessesSnapshot struct {
	MessageType string         `json:"type"`
	ObservedAt  string         `json:"observedAt"`
	Processes   []ProcessEntry `json:"processes"`
}

type ProcessesStreamMessage struct {
	Refresh  *ProcessesRefresh
	Snapshot *ProcessesSnapshot
}

func ProcessesSnapshotPayload(snapshot ProcessesSnapshot) (string, error) {
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func ParseProcessesStreamMessage(payload string) (ProcessesStreamMessage, error) {
	var envelope struct {
		MessageType string `json:"type"`
	}
	if err := json.Unmarshal([]byte(payload), &envelope); err != nil {
		return ProcessesStreamMessage{}, fmt.Errorf("processes stream message must be valid json: %w", err)
	}
	switch envelope.MessageType {
	case "processes.refresh":
		var refresh ProcessesRefresh
		if err := json.Unmarshal([]byte(payload), &refresh); err != nil {
			return ProcessesStreamMessage{}, fmt.Errorf("processes.refresh message is invalid: %w", err)
		}
		return ProcessesStreamMessage{Refresh: &refresh}, nil
	case "processes.snapshot":
		var snapshot ProcessesSnapshot
		if err := json.Unmarshal([]byte(payload), &snapshot); err != nil {
			return ProcessesStreamMessage{}, fmt.Errorf("processes.snapshot message is invalid: %w", err)
		}
		return ProcessesStreamMessage{Snapshot: &snapshot}, nil
	default:
		return ProcessesStreamMessage{}, fmt.Errorf("unsupported processes stream message type %q", envelope.MessageType)
	}
}
