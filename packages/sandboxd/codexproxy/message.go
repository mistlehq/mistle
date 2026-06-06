package codexproxy

import (
	"encoding/json"
	"fmt"
)

type ThreadStatusKind string

const (
	ThreadStatusNotLoaded   ThreadStatusKind = "notLoaded"
	ThreadStatusIdle        ThreadStatusKind = "idle"
	ThreadStatusSystemError ThreadStatusKind = "systemError"
	ThreadStatusActive      ThreadStatusKind = "active"
)

type ThreadStatus struct {
	Kind        ThreadStatusKind
	ActiveFlags []string
}

func (status ThreadStatus) IsActive() bool {
	return status.Kind == ThreadStatusActive
}

func (status *ThreadStatus) UnmarshalJSON(data []byte) error {
	var raw struct {
		Type        ThreadStatusKind `json:"type"`
		ActiveFlags []string         `json:"activeFlags"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	switch raw.Type {
	case ThreadStatusNotLoaded, ThreadStatusIdle, ThreadStatusSystemError:
		*status = ThreadStatus{Kind: raw.Type}
		return nil
	case ThreadStatusActive:
		*status = ThreadStatus{Kind: raw.Type, ActiveFlags: raw.ActiveFlags}
		return nil
	default:
		return fmt.Errorf("unsupported Codex thread status type: %s", raw.Type)
	}
}

func ParseThreadReadResponse(response []byte) (ThreadStatus, error) {
	var raw struct {
		Result struct {
			Thread struct {
				Status ThreadStatus `json:"status"`
			} `json:"thread"`
		} `json:"result"`
	}
	if err := json.Unmarshal(response, &raw); err != nil {
		return ThreadStatus{}, fmt.Errorf("thread/read response has invalid status: %w", err)
	}
	return raw.Result.Thread.Status, nil
}

func ParseThreadLoadedListResponse(response []byte) ([]string, error) {
	var raw struct {
		Result struct {
			Data []json.RawMessage `json:"data"`
		} `json:"result"`
	}
	if err := json.Unmarshal(response, &raw); err != nil {
		return nil, err
	}
	threadIDs := make([]string, 0, len(raw.Result.Data))
	for _, rawThreadID := range raw.Result.Data {
		var threadID string
		if err := json.Unmarshal(rawThreadID, &threadID); err != nil {
			return nil, fmt.Errorf("thread/loaded/list response contains a non-string thread id")
		}
		threadIDs = append(threadIDs, threadID)
	}
	return threadIDs, nil
}

type ThreadStatusUpdate struct {
	ThreadID string
	Status   ThreadStatus
}

func ParseThreadStatusChangedMessage(payload []byte) (*ThreadStatusUpdate, error) {
	var envelope struct {
		Method *string          `json:"method"`
		Params *json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, err
	}
	if envelope.Method == nil || *envelope.Method != "thread/status/changed" {
		return nil, nil
	}
	if envelope.Params == nil {
		return nil, fmt.Errorf("thread/status/changed notification is missing params")
	}
	var params struct {
		ThreadID string       `json:"threadId"`
		Status   ThreadStatus `json:"status"`
	}
	if err := json.Unmarshal(*envelope.Params, &params); err != nil {
		return nil, err
	}
	return &ThreadStatusUpdate{ThreadID: params.ThreadID, Status: params.Status}, nil
}
