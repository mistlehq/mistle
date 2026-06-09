package protocol

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	PortAccessAuthorizeReasonPortUnreachable     = "port_unreachable"
	PortAccessAuthorizeReasonUnsupportedProtocol = "unsupported_protocol"
)

type PortAccessTarget struct {
	Kind string `json:"kind"`
	Port uint16 `json:"port"`
}

type PortsTargetAuthorize struct {
	MessageType string           `json:"type"`
	RequestID   string           `json:"requestId"`
	Target      PortAccessTarget `json:"target"`
}

type PortsControlMessage struct {
	TargetAuthorize *PortsTargetAuthorize
}

type RepeatedHeaderValues map[string][]string

type PortsHTTPOpen struct {
	MessageType      string           `json:"type"`
	StreamID         uint32           `json:"streamId"`
	Target           PortAccessTarget `json:"target"`
	UpstreamProtocol string           `json:"upstreamProtocol"`
	Request          PortsHTTPRequest `json:"request"`
}

type PortsHTTPRequest struct {
	Method  string               `json:"method"`
	Path    string               `json:"path"`
	Query   *string              `json:"query,omitempty"`
	Headers RepeatedHeaderValues `json:"headers"`
}

type PortsTCPOpen struct {
	MessageType      string           `json:"type"`
	StreamID         uint32           `json:"streamId"`
	Target           PortAccessTarget `json:"target"`
	UpstreamProtocol string           `json:"upstreamProtocol"`
}

type PortsTCPConnected struct {
	MessageType string `json:"type"`
	StreamID    uint32 `json:"streamId"`
}

type PortsTCPClose struct {
	MessageType string `json:"type"`
	StreamID    uint32 `json:"streamId"`
	Direction   string `json:"direction"`
}

type PortsTCPError struct {
	MessageType string `json:"type"`
	StreamID    uint32 `json:"streamId"`
	Code        string `json:"code"`
	Message     string `json:"message"`
}

type PortsHTTPBodyChunk struct {
	MessageType string `json:"type"`
	StreamID    uint32 `json:"streamId"`
	Direction   string `json:"direction"`
	Bytes       string `json:"bytes"`
	Encoding    string `json:"encoding"`
}

type PortsHTTPBodyEnd struct {
	MessageType string `json:"type"`
	StreamID    uint32 `json:"streamId"`
	Direction   string `json:"direction"`
}

type PortsHTTPResponseStart struct {
	MessageType string               `json:"type"`
	StreamID    uint32               `json:"streamId"`
	Status      int                  `json:"status"`
	Headers     RepeatedHeaderValues `json:"headers"`
}

type PortsStreamClose struct {
	MessageType string `json:"type"`
	StreamID    uint32 `json:"streamId"`
}

type PortsStreamError struct {
	MessageType string `json:"type"`
	StreamID    uint32 `json:"streamId"`
	Code        string `json:"code"`
	Message     string `json:"message"`
}

type PortsTransportMessage struct {
	TCPOpen           *PortsTCPOpen
	TCPConnected      *PortsTCPConnected
	TCPClose          *PortsTCPClose
	TCPError          *PortsTCPError
	HTTPOpen          *PortsHTTPOpen
	HTTPResponseStart *PortsHTTPResponseStart
	HTTPBodyChunk     *PortsHTTPBodyChunk
	HTTPBodyEnd       *PortsHTTPBodyEnd
	StreamClose       *PortsStreamClose
	StreamError       *PortsStreamError
}

func ParsePortsControlMessage(payload string) (*PortsControlMessage, error) {
	var raw struct {
		Type *string `json:"type"`
	}
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		return nil, fmt.Errorf("ports control message must be valid json: %w", err)
	}
	if raw.Type == nil {
		return nil, nil
	}
	switch *raw.Type {
	case "ports.target.authorize":
		var message PortsTargetAuthorize
		if err := json.Unmarshal([]byte(payload), &message); err != nil {
			return nil, fmt.Errorf("ports.target.authorize message is invalid: %w", err)
		}
		if err := ValidatePortsTargetAuthorize(message); err != nil {
			return nil, err
		}
		return &PortsControlMessage{TargetAuthorize: &message}, nil
	default:
		return nil, nil
	}
}

func ParsePortsTransportMessage(payload string) (*PortsTransportMessage, error) {
	var raw struct {
		Type *string `json:"type"`
	}
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		return nil, fmt.Errorf("ports transport message must be valid json: %w", err)
	}
	if raw.Type == nil {
		return nil, nil
	}
	switch *raw.Type {
	case "ports.tcp.open":
		var message PortsTCPOpen
		if err := json.Unmarshal([]byte(payload), &message); err != nil {
			return nil, fmt.Errorf("ports.tcp.open message is invalid: %w", err)
		}
		if err := ValidatePortsTCPOpen(message); err != nil {
			return nil, err
		}
		return &PortsTransportMessage{TCPOpen: &message}, nil
	case "ports.tcp.connected":
		var message PortsTCPConnected
		if err := json.Unmarshal([]byte(payload), &message); err != nil {
			return nil, fmt.Errorf("ports.tcp.connected message is invalid: %w", err)
		}
		if err := validateStreamID(message.StreamID); err != nil {
			return nil, err
		}
		return &PortsTransportMessage{TCPConnected: &message}, nil
	case "ports.tcp.close":
		var message PortsTCPClose
		if err := json.Unmarshal([]byte(payload), &message); err != nil {
			return nil, fmt.Errorf("ports.tcp.close message is invalid: %w", err)
		}
		if err := ValidatePortsTCPClose(message); err != nil {
			return nil, err
		}
		return &PortsTransportMessage{TCPClose: &message}, nil
	case "ports.tcp.error":
		var message PortsTCPError
		if err := json.Unmarshal([]byte(payload), &message); err != nil {
			return nil, fmt.Errorf("ports.tcp.error message is invalid: %w", err)
		}
		if err := ValidatePortsTCPError(message); err != nil {
			return nil, err
		}
		return &PortsTransportMessage{TCPError: &message}, nil
	case "ports.http.open":
		var message PortsHTTPOpen
		if err := json.Unmarshal([]byte(payload), &message); err != nil {
			return nil, fmt.Errorf("ports.http.open message is invalid: %w", err)
		}
		if err := ValidatePortsHTTPOpen(message); err != nil {
			return nil, err
		}
		return &PortsTransportMessage{HTTPOpen: &message}, nil
	case "ports.http.response.start":
		var message PortsHTTPResponseStart
		if err := json.Unmarshal([]byte(payload), &message); err != nil {
			return nil, fmt.Errorf("ports.http.response.start message is invalid: %w", err)
		}
		if err := ValidatePortsHTTPResponseStart(message); err != nil {
			return nil, err
		}
		return &PortsTransportMessage{HTTPResponseStart: &message}, nil
	case "ports.http.body.chunk":
		var message PortsHTTPBodyChunk
		if err := json.Unmarshal([]byte(payload), &message); err != nil {
			return nil, fmt.Errorf("ports.http.body.chunk message is invalid: %w", err)
		}
		if err := ValidatePortsHTTPBodyChunk(message); err != nil {
			return nil, err
		}
		return &PortsTransportMessage{HTTPBodyChunk: &message}, nil
	case "ports.http.body.end":
		var message PortsHTTPBodyEnd
		if err := json.Unmarshal([]byte(payload), &message); err != nil {
			return nil, fmt.Errorf("ports.http.body.end message is invalid: %w", err)
		}
		if err := ValidatePortsHTTPBodyEnd(message); err != nil {
			return nil, err
		}
		return &PortsTransportMessage{HTTPBodyEnd: &message}, nil
	case "ports.stream.close":
		var message PortsStreamClose
		if err := json.Unmarshal([]byte(payload), &message); err != nil {
			return nil, fmt.Errorf("ports.stream.close message is invalid: %w", err)
		}
		if err := validateStreamID(message.StreamID); err != nil {
			return nil, err
		}
		return &PortsTransportMessage{StreamClose: &message}, nil
	case "ports.stream.error":
		var message PortsStreamError
		if err := json.Unmarshal([]byte(payload), &message); err != nil {
			return nil, fmt.Errorf("ports.stream.error message is invalid: %w", err)
		}
		if err := ValidatePortsStreamError(message); err != nil {
			return nil, err
		}
		return &PortsTransportMessage{StreamError: &message}, nil
	default:
		return nil, nil
	}
}

func PortsTCPConnectedPayload(streamID uint32) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":     "ports.tcp.connected",
		"streamId": streamID,
	})
}

func PortsTCPClosePayload(streamID uint32, direction string) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":      "ports.tcp.close",
		"streamId":  streamID,
		"direction": direction,
	})
}

func PortsTCPErrorPayload(streamID uint32, code string, message string) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":     "ports.tcp.error",
		"streamId": streamID,
		"code":     code,
		"message":  message,
	})
}

func PortsTargetAuthorizeSuccessResult(requestID string, upstreamProtocol string, websocketCapable bool) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":             "ports.target.authorize.result",
		"requestId":        requestID,
		"authorized":       true,
		"upstreamProtocol": upstreamProtocol,
		"websocketCapable": websocketCapable,
	})
}

func PortsTargetAuthorizeFailureResult(requestID string, reason string) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":       "ports.target.authorize.result",
		"requestId":  requestID,
		"authorized": false,
		"reason":     reason,
	})
}

func PortsHTTPResponseStartPayload(message PortsHTTPResponseStart) (string, error) {
	message.MessageType = "ports.http.response.start"
	return marshalControlPayload(map[string]any{
		"type":     message.MessageType,
		"streamId": message.StreamID,
		"status":   message.Status,
		"headers":  message.Headers,
	})
}

func PortsHTTPBodyChunkPayload(streamID uint32, direction string, encodedBytes string) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":      "ports.http.body.chunk",
		"streamId":  streamID,
		"direction": direction,
		"bytes":     encodedBytes,
		"encoding":  "base64",
	})
}

func PortsHTTPBodyEndPayload(streamID uint32, direction string) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":      "ports.http.body.end",
		"streamId":  streamID,
		"direction": direction,
	})
}

func PortsStreamErrorPayload(streamID uint32, code string, message string) (string, error) {
	return marshalControlPayload(map[string]any{
		"type":     "ports.stream.error",
		"streamId": streamID,
		"code":     code,
		"message":  message,
	})
}

func ValidatePortsTargetAuthorize(message PortsTargetAuthorize) error {
	if message.MessageType != "ports.target.authorize" {
		return fmt.Errorf("ports.target.authorize message type must be 'ports.target.authorize', got %q", message.MessageType)
	}
	if strings.TrimSpace(message.RequestID) == "" {
		return fmt.Errorf("ports.target.authorize requestId is required")
	}
	return ValidatePortAccessTarget(message.Target)
}

func ValidatePortsTCPOpen(message PortsTCPOpen) error {
	if message.MessageType != "ports.tcp.open" {
		return fmt.Errorf("ports.tcp.open message type must be 'ports.tcp.open', got %q", message.MessageType)
	}
	if err := validateStreamID(message.StreamID); err != nil {
		return err
	}
	if err := ValidatePortAccessTarget(message.Target); err != nil {
		return err
	}
	if message.UpstreamProtocol != "http" && message.UpstreamProtocol != "https" {
		return fmt.Errorf("ports.tcp.open upstreamProtocol must be 'http' or 'https', got %q", message.UpstreamProtocol)
	}
	return nil
}

func ValidatePortsTCPClose(message PortsTCPClose) error {
	if message.MessageType != "ports.tcp.close" {
		return fmt.Errorf("ports.tcp.close message type must be 'ports.tcp.close', got %q", message.MessageType)
	}
	if err := validateStreamID(message.StreamID); err != nil {
		return err
	}
	if message.Direction != "request" && message.Direction != "response" {
		return fmt.Errorf("ports.tcp.close direction must be 'request' or 'response', got %q", message.Direction)
	}
	return nil
}

func ValidatePortsTCPError(message PortsTCPError) error {
	if message.MessageType != "ports.tcp.error" {
		return fmt.Errorf("ports.tcp.error message type must be 'ports.tcp.error', got %q", message.MessageType)
	}
	if err := validateStreamID(message.StreamID); err != nil {
		return err
	}
	if err := validatePortAccessUpstreamError(message.Code, message.Message, "ports.tcp.error"); err != nil {
		return err
	}
	return nil
}

func ValidatePortsHTTPOpen(message PortsHTTPOpen) error {
	if message.MessageType != "ports.http.open" {
		return fmt.Errorf("ports.http.open message type must be 'ports.http.open', got %q", message.MessageType)
	}
	if err := validateStreamID(message.StreamID); err != nil {
		return err
	}
	if err := ValidatePortAccessTarget(message.Target); err != nil {
		return err
	}
	if message.UpstreamProtocol != "http" && message.UpstreamProtocol != "https" {
		return fmt.Errorf("ports.http.open upstreamProtocol must be 'http' or 'https', got %q", message.UpstreamProtocol)
	}
	if strings.TrimSpace(message.Request.Method) == "" {
		return fmt.Errorf("ports.http.open request.method is required")
	}
	if strings.TrimSpace(message.Request.Path) == "" {
		return fmt.Errorf("ports.http.open request.path is required")
	}
	if message.Request.Query != nil && *message.Request.Query == "" {
		return fmt.Errorf("ports.http.open request.query must be non-empty when provided")
	}
	return validateRepeatedHeaderValues(message.Request.Headers, "ports.http.open request.headers")
}

func ValidatePortsHTTPResponseStart(message PortsHTTPResponseStart) error {
	if message.MessageType != "ports.http.response.start" {
		return fmt.Errorf("ports.http.response.start message type must be 'ports.http.response.start', got %q", message.MessageType)
	}
	if err := validateStreamID(message.StreamID); err != nil {
		return err
	}
	if message.Status < 200 || message.Status > 599 {
		return fmt.Errorf("ports.http.response.start status must be between 200 and 599")
	}
	return validateRepeatedHeaderValues(message.Headers, "ports.http.response.start headers")
}

func ValidatePortsHTTPBodyChunk(message PortsHTTPBodyChunk) error {
	if message.MessageType != "ports.http.body.chunk" {
		return fmt.Errorf("ports.http.body.chunk message type must be 'ports.http.body.chunk', got %q", message.MessageType)
	}
	if err := validateStreamID(message.StreamID); err != nil {
		return err
	}
	if message.Direction != "request" && message.Direction != "response" {
		return fmt.Errorf("ports.http.body.chunk direction must be 'request' or 'response', got %q", message.Direction)
	}
	if message.Encoding != "base64" {
		return fmt.Errorf("ports.http.body.chunk encoding must be 'base64', got %q", message.Encoding)
	}
	return nil
}

func ValidatePortsHTTPBodyEnd(message PortsHTTPBodyEnd) error {
	if message.MessageType != "ports.http.body.end" {
		return fmt.Errorf("ports.http.body.end message type must be 'ports.http.body.end', got %q", message.MessageType)
	}
	if err := validateStreamID(message.StreamID); err != nil {
		return err
	}
	if message.Direction != "request" && message.Direction != "response" {
		return fmt.Errorf("ports.http.body.end direction must be 'request' or 'response', got %q", message.Direction)
	}
	return nil
}

func ValidatePortsStreamError(message PortsStreamError) error {
	if message.MessageType != "ports.stream.error" {
		return fmt.Errorf("ports.stream.error message type must be 'ports.stream.error', got %q", message.MessageType)
	}
	if err := validateStreamID(message.StreamID); err != nil {
		return err
	}
	if err := validatePortAccessUpstreamError(message.Code, message.Message, "ports.stream.error"); err != nil {
		return err
	}
	return nil
}

func ValidatePortAccessTarget(target PortAccessTarget) error {
	if target.Kind != "port" {
		return fmt.Errorf("ports target kind must be 'port', got %q", target.Kind)
	}
	if target.Port == 0 {
		return fmt.Errorf("ports target port must be greater than zero")
	}
	return nil
}

func validatePortAccessUpstreamError(code string, message string, fieldName string) error {
	switch code {
	case "upstream_connect_failed", "upstream_handshake_failed", "upstream_io_error":
	default:
		return fmt.Errorf("%s code is not supported: %q", fieldName, code)
	}
	if strings.TrimSpace(message) == "" {
		return fmt.Errorf("%s message is required", fieldName)
	}
	return nil
}

func validateRepeatedHeaderValues(headers RepeatedHeaderValues, fieldName string) error {
	for headerName := range headers {
		if strings.TrimSpace(headerName) == "" {
			return fmt.Errorf("%s header names must be non-empty", fieldName)
		}
	}
	return nil
}
