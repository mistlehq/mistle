package tunnel

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/coder/websocket"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const (
	SandboxOperationStreamID     = uint32(0xffff_fffd)
	SandboxOperationStreamFormat = "mistle.sandbox-operation.v1+jsonl"
	pendingOperationRecordLimit  = 1024
)

type operationStreamState struct {
	requested       bool
	closeRequested  bool
	sendWindow      *uint64
	pendingRecords  []string
	closeCompletion chan error
}

func (session *LiveTunnelSession) openOperationStream(ctx context.Context) error {
	if session.operationID == "" {
		return nil
	}
	payload, err := operationOpenPayload(session.operationID, session.operationKind)
	if err != nil {
		return err
	}
	session.mutex.Lock()
	session.operation.requested = true
	session.mutex.Unlock()
	return session.writeRawControl(ctx, payload)
}

func (session *LiveTunnelSession) RecordOperationLine(ctx context.Context, line string) error {
	session.mutex.Lock()
	if len(session.operation.pendingRecords) >= pendingOperationRecordLimit {
		session.mutex.Unlock()
		return nil
	}
	session.operation.pendingRecords = append(session.operation.pendingRecords, line)
	session.mutex.Unlock()
	return session.flushOperationRecords(ctx)
}

func (session *LiveTunnelSession) CloseOperationStream(ctx context.Context) error {
	completion := make(chan error, 1)
	session.mutex.Lock()
	session.operation.closeRequested = true
	session.operation.closeCompletion = completion
	session.mutex.Unlock()
	if err := session.flushOperationRecords(ctx); err != nil {
		return err
	}
	if err := session.closeOperationStreamIfDrained(ctx); err != nil {
		return err
	}
	select {
	case err := <-completion:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (session *LiveTunnelSession) handleOperationControl(ctx context.Context, payload string) (bool, error) {
	message, err := parseOperationControl(payload)
	if err != nil {
		return false, nil
	}
	if message == nil {
		return false, nil
	}
	switch message.messageType {
	case "operation.open.ok":
		if message.streamID != SandboxOperationStreamID {
			return true, nil
		}
		if message.initialWindowBytes == nil {
			session.mutex.Lock()
			session.operation.sendWindow = nil
			session.mutex.Unlock()
			return true, nil
		}
		window := *message.initialWindowBytes
		session.mutex.Lock()
		session.operation.sendWindow = &window
		session.mutex.Unlock()
		if err := session.flushOperationRecords(ctx); err != nil {
			return true, err
		}
		return true, session.closeOperationStreamIfDrained(ctx)
	case "operation.window":
		if message.streamID != SandboxOperationStreamID {
			return true, nil
		}
		session.mutex.Lock()
		if session.operation.sendWindow != nil && message.bytes != nil {
			*session.operation.sendWindow += *message.bytes
		}
		session.mutex.Unlock()
		if err := session.flushOperationRecords(ctx); err != nil {
			return true, err
		}
		return true, session.closeOperationStreamIfDrained(ctx)
	case "operation.open.error", "operation.reset":
		session.mutex.Lock()
		completion := session.operation.closeCompletion
		session.operation = operationStreamState{}
		session.mutex.Unlock()
		if completion != nil {
			completion <- fmt.Errorf("%s received", message.messageType)
		}
		return true, nil
	default:
		return true, nil
	}
}

func (session *LiveTunnelSession) flushOperationRecords(ctx context.Context) error {
	for {
		session.mutex.Lock()
		if session.operation.sendWindow == nil || len(session.operation.pendingRecords) == 0 {
			session.mutex.Unlock()
			return nil
		}
		line := session.operation.pendingRecords[0]
		if *session.operation.sendWindow < uint64(len(line)) {
			session.mutex.Unlock()
			return nil
		}
		*session.operation.sendWindow -= uint64(len(line))
		session.operation.pendingRecords = session.operation.pendingRecords[1:]
		session.mutex.Unlock()
		if err := session.writeOperationRecord(ctx, []byte(line)); err != nil {
			return err
		}
	}
}

func (session *LiveTunnelSession) writeOperationRecord(ctx context.Context, payload []byte) error {
	encoded, err := tunnelprotocol.EncodeStreamDataFrame(SandboxOperationStreamID, tunnelprotocol.PayloadKindRawBytes, payload)
	if err != nil {
		return err
	}
	session.writeMutex.Lock()
	defer session.writeMutex.Unlock()
	return session.connection.Write(ctx, websocket.MessageBinary, encoded)
}

func (session *LiveTunnelSession) closeOperationStreamIfDrained(ctx context.Context) error {
	session.mutex.Lock()
	if !session.operation.closeRequested || len(session.operation.pendingRecords) > 0 {
		session.mutex.Unlock()
		return nil
	}
	completion := session.operation.closeCompletion
	requested := session.operation.requested
	session.operation = operationStreamState{}
	session.mutex.Unlock()
	if !requested {
		if completion != nil {
			completion <- nil
		}
		return nil
	}
	payload, err := operationClosePayload()
	if err != nil {
		if completion != nil {
			completion <- err
		}
		return err
	}
	if err := session.writeRawControl(ctx, payload); err != nil {
		if completion != nil {
			completion <- err
		}
		return err
	}
	if completion != nil {
		completion <- nil
	}
	return nil
}

type operationControlMessage struct {
	messageType        string
	streamID           uint32
	initialWindowBytes *uint64
	bytes              *uint64
}

func parseOperationControl(payload string) (*operationControlMessage, error) {
	var raw struct {
		Type               *string `json:"type"`
		StreamID           uint32  `json:"streamId"`
		InitialWindowBytes *uint64 `json:"initialWindowBytes"`
		Bytes              *uint64 `json:"bytes"`
	}
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		return nil, err
	}
	if raw.Type == nil || !isOperationControlType(*raw.Type) {
		return nil, nil
	}
	return &operationControlMessage{
		messageType:        *raw.Type,
		streamID:           raw.StreamID,
		initialWindowBytes: raw.InitialWindowBytes,
		bytes:              raw.Bytes,
	}, nil
}

func isOperationControlType(messageType string) bool {
	switch messageType {
	case "operation.open.ok", "operation.window", "operation.open.error", "operation.reset":
		return true
	default:
		return len(messageType) >= len("operation.") && messageType[:len("operation.")] == "operation."
	}
}

func operationOpenPayload(operationID string, operationKind string) (string, error) {
	payload, err := json.Marshal(map[string]any{
		"type":          "operation.open",
		"streamId":      SandboxOperationStreamID,
		"operationId":   operationID,
		"operationKind": operationKind,
		"format":        SandboxOperationStreamFormat,
	})
	return string(payload), err
}

func operationClosePayload() (string, error) {
	payload, err := json.Marshal(map[string]any{
		"type":     "operation.close",
		"streamId": SandboxOperationStreamID,
	})
	return string(payload), err
}
