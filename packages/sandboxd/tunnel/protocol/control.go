package protocol

import (
	"encoding/json"
	"fmt"
	"strings"
)

type StreamChannel struct {
	Kind             string   `json:"kind"`
	ThreadID         string   `json:"threadId,omitempty"`
	MimeType         string   `json:"mimeType,omitempty"`
	OriginalFilename string   `json:"originalFilename,omitempty"`
	SizeBytes        uint64   `json:"sizeBytes,omitempty"`
	Command          string   `json:"command,omitempty"`
	Args             []string `json:"args,omitempty"`
	CWD              *string  `json:"cwd,omitempty"`
	Stdin            *string  `json:"stdin,omitempty"`
	TimeoutMs        *uint64  `json:"timeoutMs,omitempty"`
	MaxOutputBytes   *uint64  `json:"maxOutputBytes,omitempty"`
}

type FileSearchQuery struct {
	MessageType string  `json:"type"`
	RequestID   string  `json:"requestId"`
	Query       string  `json:"query"`
	Limit       *uint64 `json:"limit,omitempty"`
}

type FileSearchSelect struct {
	MessageType string `json:"type"`
	Query       string `json:"query"`
	Path        string `json:"path"`
}

type FileSearchResultItem struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
}

type FileSearchResults struct {
	MessageType string                 `json:"type"`
	RequestID   string                 `json:"requestId"`
	Query       string                 `json:"query"`
	Items       []FileSearchResultItem `json:"items"`
}

type FileSearchError struct {
	MessageType string `json:"type"`
	RequestID   string `json:"requestId"`
	Code        string `json:"code"`
	Message     string `json:"message"`
}

type FileSearchStreamMessage struct {
	Query   *FileSearchQuery
	Select  *FileSearchSelect
	Results *FileSearchResults
	Error   *FileSearchError
}

type StreamOpen struct {
	MessageType string        `json:"type"`
	StreamID    uint32        `json:"streamId"`
	Channel     StreamChannel `json:"channel"`
}

type StreamClose struct {
	MessageType string `json:"type"`
	StreamID    uint32 `json:"streamId"`
}

type StreamWindow struct {
	MessageType string `json:"type"`
	StreamID    uint32 `json:"streamId"`
	Bytes       uint64 `json:"bytes"`
}

type StreamSignal struct {
	MessageType string          `json:"type"`
	StreamID    uint32          `json:"streamId"`
	Signal      json.RawMessage `json:"signal"`
}

type PTYResizeSignal struct {
	SignalType string `json:"type"`
	Cols       uint16 `json:"cols"`
	Rows       uint16 `json:"rows"`
}

type StreamControlMessage struct {
	Open   *StreamOpen
	Close  *StreamClose
	Window *StreamWindow
	Signal *StreamSignal
}

func ParseStreamControlMessage(payload string) (StreamControlMessage, error) {
	var envelope struct {
		MessageType string `json:"type"`
	}
	if err := json.Unmarshal([]byte(payload), &envelope); err != nil {
		return StreamControlMessage{}, fmt.Errorf("stream control message must be valid json: %w", err)
	}
	switch envelope.MessageType {
	case "stream.open":
		var open StreamOpen
		if err := json.Unmarshal([]byte(payload), &open); err != nil {
			return StreamControlMessage{}, fmt.Errorf("stream.open message is invalid: %w", err)
		}
		if err := validateStreamID(open.StreamID); err != nil {
			return StreamControlMessage{}, err
		}
		if open.Channel.Kind == "" {
			return StreamControlMessage{}, fmt.Errorf("stream.open channel kind is required")
		}
		return StreamControlMessage{Open: &open}, nil
	case "stream.close":
		var closeMessage StreamClose
		if err := json.Unmarshal([]byte(payload), &closeMessage); err != nil {
			return StreamControlMessage{}, fmt.Errorf("stream.close message is invalid: %w", err)
		}
		if err := validateStreamID(closeMessage.StreamID); err != nil {
			return StreamControlMessage{}, err
		}
		return StreamControlMessage{Close: &closeMessage}, nil
	case "stream.window":
		var window StreamWindow
		if err := json.Unmarshal([]byte(payload), &window); err != nil {
			return StreamControlMessage{}, fmt.Errorf("stream.window message is invalid: %w", err)
		}
		if err := validateStreamID(window.StreamID); err != nil {
			return StreamControlMessage{}, err
		}
		if window.Bytes == 0 {
			return StreamControlMessage{}, fmt.Errorf("stream.window bytes must be a positive integer")
		}
		return StreamControlMessage{Window: &window}, nil
	case "stream.signal":
		var signal StreamSignal
		if err := json.Unmarshal([]byte(payload), &signal); err != nil {
			return StreamControlMessage{}, fmt.Errorf("stream.signal message is invalid: %w", err)
		}
		if err := validateStreamID(signal.StreamID); err != nil {
			return StreamControlMessage{}, err
		}
		if len(signal.Signal) == 0 {
			return StreamControlMessage{}, fmt.Errorf("stream.signal signal is required")
		}
		return StreamControlMessage{Signal: &signal}, nil
	default:
		return StreamControlMessage{}, fmt.Errorf("unsupported stream control message type %q", envelope.MessageType)
	}
}

type PTYControlMessage struct {
	Signal *PTYStreamSignal
	Close  *StreamClose
	Window *StreamWindow
}

type PTYStreamSignal struct {
	MessageType string          `json:"type"`
	StreamID    uint32          `json:"streamId"`
	Signal      PTYResizeSignal `json:"signal"`
}

func ParsePTYControlMessage(payload string) (PTYControlMessage, error) {
	message, err := ParseStreamControlMessage(payload)
	if err != nil {
		return PTYControlMessage{}, err
	}
	switch {
	case message.Signal != nil:
		var signal PTYResizeSignal
		if err := json.Unmarshal(message.Signal.Signal, &signal); err != nil {
			return PTYControlMessage{}, fmt.Errorf("stream.signal signal is invalid: %w", err)
		}
		if signal.SignalType != "pty.resize" {
			return PTYControlMessage{}, fmt.Errorf("stream.signal pty signal type is not supported: %s", signal.SignalType)
		}
		if signal.Cols == 0 || signal.Rows == 0 {
			return PTYControlMessage{}, fmt.Errorf("pty resize cols and rows must be between 1 and 65535")
		}
		return PTYControlMessage{Signal: &PTYStreamSignal{
			MessageType: message.Signal.MessageType,
			StreamID:    message.Signal.StreamID,
			Signal:      signal,
		}}, nil
	case message.Close != nil:
		return PTYControlMessage{Close: message.Close}, nil
	case message.Window != nil:
		return PTYControlMessage{Window: message.Window}, nil
	default:
		return PTYControlMessage{}, fmt.Errorf("pty control message type is not supported")
	}
}

type PTYSessionLaunch struct {
	Session string   `json:"session"`
	Cols    *uint16  `json:"cols,omitempty"`
	Rows    *uint16  `json:"rows,omitempty"`
	CWD     *string  `json:"cwd,omitempty"`
	Command *string  `json:"command,omitempty"`
	Args    []string `json:"args,omitempty"`
}

type PTYSessionOpen struct {
	MessageType    string           `json:"type"`
	RequestID      string           `json:"requestId"`
	PTYSessionID   string           `json:"ptySessionId"`
	TransportURL   string           `json:"transportUrl"`
	TransportToken string           `json:"transportToken"`
	Launch         PTYSessionLaunch `json:"launch"`
}

type PTYSessionOpened struct {
	MessageType  string `json:"type"`
	RequestID    string `json:"requestId"`
	PTYSessionID string `json:"ptySessionId"`
}

type PTYSessionError struct {
	MessageType  string `json:"type"`
	RequestID    string `json:"requestId"`
	PTYSessionID string `json:"ptySessionId"`
	Code         string `json:"code"`
	Message      string `json:"message"`
}

type PTYSessionControlMessage struct {
	Open   *PTYSessionOpen
	Opened *PTYSessionOpened
	Error  *PTYSessionError
}

func ParsePTYSessionControlMessage(payload string) (*PTYSessionControlMessage, error) {
	var envelope struct {
		MessageType string `json:"type"`
	}
	if err := json.Unmarshal([]byte(payload), &envelope); err != nil {
		return nil, fmt.Errorf("pty session control message must be valid json: %w", err)
	}
	switch envelope.MessageType {
	case "pty.session.open":
		var open PTYSessionOpen
		if err := json.Unmarshal([]byte(payload), &open); err != nil {
			return nil, fmt.Errorf("pty.session.open message is invalid: %w", err)
		}
		if open.MessageType != "pty.session.open" {
			return nil, fmt.Errorf("pty.session.open message type must be 'pty.session.open'")
		}
		if strings.TrimSpace(open.RequestID) == "" {
			return nil, fmt.Errorf("pty.session.open requestId is required")
		}
		if strings.TrimSpace(open.PTYSessionID) == "" {
			return nil, fmt.Errorf("pty.session.open ptySessionId is required")
		}
		if !strings.HasPrefix(open.TransportURL, "ws://") && !strings.HasPrefix(open.TransportURL, "wss://") {
			return nil, fmt.Errorf("pty.session.open transportUrl must use ws or wss")
		}
		if strings.TrimSpace(open.TransportToken) == "" {
			return nil, fmt.Errorf("pty.session.open transportToken is required")
		}
		if err := validatePTYSessionLaunch(open.Launch); err != nil {
			return nil, err
		}
		return &PTYSessionControlMessage{Open: &open}, nil
	case "pty.session.opened":
		var opened PTYSessionOpened
		if err := json.Unmarshal([]byte(payload), &opened); err != nil {
			return nil, fmt.Errorf("pty.session.opened message is invalid: %w", err)
		}
		if opened.MessageType != "pty.session.opened" {
			return nil, fmt.Errorf("pty.session.opened message type must be 'pty.session.opened'")
		}
		if strings.TrimSpace(opened.RequestID) == "" {
			return nil, fmt.Errorf("pty.session.opened requestId is required")
		}
		if strings.TrimSpace(opened.PTYSessionID) == "" {
			return nil, fmt.Errorf("pty.session.opened ptySessionId is required")
		}
		return &PTYSessionControlMessage{Opened: &opened}, nil
	case "pty.session.error":
		var ptyError PTYSessionError
		if err := json.Unmarshal([]byte(payload), &ptyError); err != nil {
			return nil, fmt.Errorf("pty.session.error message is invalid: %w", err)
		}
		if ptyError.MessageType != "pty.session.error" {
			return nil, fmt.Errorf("pty.session.error message type must be 'pty.session.error'")
		}
		if strings.TrimSpace(ptyError.RequestID) == "" {
			return nil, fmt.Errorf("pty.session.error requestId is required")
		}
		if strings.TrimSpace(ptyError.PTYSessionID) == "" {
			return nil, fmt.Errorf("pty.session.error ptySessionId is required")
		}
		switch ptyError.Code {
		case "transport_connect_failed", "pty_create_failed", "pty_attach_failed", "internal_error":
		default:
			return nil, fmt.Errorf("pty.session.error code is invalid")
		}
		if strings.TrimSpace(ptyError.Message) == "" {
			return nil, fmt.Errorf("pty.session.error message is required")
		}
		return &PTYSessionControlMessage{Error: &ptyError}, nil
	default:
		return nil, nil
	}
}

func validatePTYSessionLaunch(launch PTYSessionLaunch) error {
	if launch.Session != "create" && launch.Session != "attach" {
		return fmt.Errorf("pty.session.open launch.session must be 'create' or 'attach'")
	}
	if (launch.Cols == nil) != (launch.Rows == nil) {
		return fmt.Errorf("pty.session.open launch cols and rows must both be provided when either is set")
	}
	if launch.Cols != nil && (*launch.Cols == 0 || *launch.Rows == 0) {
		return fmt.Errorf("pty.session.open launch cols and rows must be greater than or equal to 1")
	}
	if launch.Command != nil && strings.TrimSpace(*launch.Command) == "" {
		return fmt.Errorf("pty.session.open launch command must be a non-empty string")
	}
	for _, arg := range launch.Args {
		if strings.TrimSpace(arg) == "" {
			return fmt.Errorf("pty.session.open launch args must contain only non-empty strings")
		}
	}
	return nil
}

func StreamOpenOK(streamID uint32) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":     "stream.open.ok",
		"streamId": streamID,
	})
}

func StreamOpenError(streamID uint32, code string, message string) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":     "stream.open.error",
		"streamId": streamID,
		"code":     code,
		"message":  message,
	})
}

func StreamReset(streamID uint32, code string, message string) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":     "stream.reset",
		"streamId": streamID,
		"code":     code,
		"message":  message,
	})
}

func StreamWindowCredit(streamID uint32, bytes int) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":     "stream.window",
		"streamId": streamID,
		"bytes":    bytes,
	})
}

func StreamComplete(streamID uint32) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":     "stream.complete",
		"streamId": streamID,
	})
}

func PTYExitEvent(streamID uint32, exitCode int) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":     "stream.event",
		"streamId": streamID,
		"event": map[string]any{
			"type":     "pty.exit",
			"exitCode": exitCode,
		},
	})
}

func PTYSessionOpenedPayload(requestID string, ptySessionID string) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":         "pty.session.opened",
		"requestId":    requestID,
		"ptySessionId": ptySessionID,
	})
}

func PTYSessionErrorPayload(requestID string, ptySessionID string, code string, message string) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":         "pty.session.error",
		"requestId":    requestID,
		"ptySessionId": ptySessionID,
		"code":         code,
		"message":      message,
	})
}

func ExecResultEvent(streamID uint32, exitCode int, stdout string, stderr string, truncated bool) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":     "stream.event",
		"streamId": streamID,
		"event": map[string]any{
			"type":      "exec.result",
			"exitCode":  exitCode,
			"stdout":    stdout,
			"stderr":    stderr,
			"truncated": truncated,
		},
	})
}

func FileUploadCompletedEvent(streamID uint32, kind string, attachmentID string, threadID string, originalFilename string, mimeType string, sizeBytes uint64, path string) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":     "stream.event",
		"streamId": streamID,
		"event": map[string]any{
			"type":             "fileUpload.completed",
			"kind":             kind,
			"attachmentId":     attachmentID,
			"threadId":         threadID,
			"originalFilename": originalFilename,
			"mimeType":         mimeType,
			"sizeBytes":        sizeBytes,
			"path":             path,
		},
	})
}

func FileSearchResultsPayload(requestID string, query string, items []FileSearchResultItem) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":      "fileSearch.results",
		"requestId": requestID,
		"query":     query,
		"items":     items,
	})
}

func FileSearchErrorPayload(requestID string, code string, message string) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":      "fileSearch.error",
		"requestId": requestID,
		"code":      code,
		"message":   message,
	})
}

func ParseFileSearchStreamMessage(payload string) (FileSearchStreamMessage, error) {
	var envelope struct {
		MessageType string `json:"type"`
	}
	if err := json.Unmarshal([]byte(payload), &envelope); err != nil {
		return FileSearchStreamMessage{}, fmt.Errorf("fileSearch stream message must be valid json: %w", err)
	}
	switch envelope.MessageType {
	case "fileSearch.query":
		var query FileSearchQuery
		if err := json.Unmarshal([]byte(payload), &query); err != nil {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.query message is invalid: %w", err)
		}
		if query.MessageType != "fileSearch.query" {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.query type must be 'fileSearch.query'")
		}
		if strings.TrimSpace(query.RequestID) == "" {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.query requestId is required")
		}
		if query.Limit != nil && *query.Limit == 0 {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.query limit must be a positive integer")
		}
		return FileSearchStreamMessage{Query: &query}, nil
	case "fileSearch.select":
		var selectMessage FileSearchSelect
		if err := json.Unmarshal([]byte(payload), &selectMessage); err != nil {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.select message is invalid: %w", err)
		}
		if selectMessage.MessageType != "fileSearch.select" {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.select type must be 'fileSearch.select'")
		}
		if strings.TrimSpace(selectMessage.Path) == "" {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.select path is required")
		}
		return FileSearchStreamMessage{Select: &selectMessage}, nil
	case "fileSearch.results":
		var results FileSearchResults
		if err := json.Unmarshal([]byte(payload), &results); err != nil {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.results message is invalid: %w", err)
		}
		if results.MessageType != "fileSearch.results" {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.results type must be 'fileSearch.results'")
		}
		if strings.TrimSpace(results.RequestID) == "" {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.results requestId is required")
		}
		for _, item := range results.Items {
			if strings.TrimSpace(item.Path) == "" {
				return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.results items must contain only non-empty paths")
			}
			if item.Kind != "file" && item.Kind != "directory" {
				return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.results item kind is invalid")
			}
		}
		return FileSearchStreamMessage{Results: &results}, nil
	case "fileSearch.error":
		var searchError FileSearchError
		if err := json.Unmarshal([]byte(payload), &searchError); err != nil {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.error message is invalid: %w", err)
		}
		if searchError.MessageType != "fileSearch.error" {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.error type must be 'fileSearch.error'")
		}
		if strings.TrimSpace(searchError.RequestID) == "" {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.error requestId is required")
		}
		if strings.TrimSpace(searchError.Code) == "" {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.error code is required")
		}
		if strings.TrimSpace(searchError.Message) == "" {
			return FileSearchStreamMessage{}, fmt.Errorf("fileSearch.error message is required")
		}
		return FileSearchStreamMessage{Error: &searchError}, nil
	default:
		return FileSearchStreamMessage{}, fmt.Errorf("unsupported fileSearch stream message type %q", envelope.MessageType)
	}
}

func marshalControlPayload(payload map[string]any) (string, error) {
	serialized, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(serialized), nil
}
