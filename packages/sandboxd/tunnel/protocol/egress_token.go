package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type EgressTokenRequest struct {
	MessageType  string  `json:"type"`
	RequestID    string  `json:"requestId"`
	ActingUserID *string `json:"actingUserId,omitempty"`
}

type EgressTokenResponse struct {
	MessageType string `json:"type"`
	RequestID   string `json:"requestId"`
	Token       string `json:"token"`
	ExpiresAt   string `json:"expiresAt"`
	TTLMS       uint64 `json:"ttlMs"`
}

type EgressToken struct {
	Token     string
	ExpiresAt string
	TTLMS     uint64
}

type EgressTokenError struct {
	MessageType string `json:"type"`
	RequestID   string `json:"requestId"`
	Code        string `json:"code"`
	Message     string `json:"message"`
}

type EgressTokenControlMessage struct {
	Request  *EgressTokenRequest
	Response *EgressTokenResponse
	Error    *EgressTokenError
}

func EgressTokenRequestPayload(request EgressTokenRequest) (string, error) {
	if err := ValidateEgressTokenRequest(request); err != nil {
		return "", err
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return "", fmt.Errorf("failed to serialize egress.token.request: %w", err)
	}
	return string(payload), nil
}

func ParseEgressTokenControlMessage(payload string) (*EgressTokenControlMessage, error) {
	var raw struct {
		Type *string `json:"type"`
	}
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		return nil, fmt.Errorf("egress token control message must be valid json: %w", err)
	}
	if raw.Type == nil {
		return nil, nil
	}
	switch *raw.Type {
	case "egress.token.request":
		var request EgressTokenRequest
		if err := decodeEgressTokenStrict([]byte(payload), &request); err != nil {
			return nil, err
		}
		if err := ValidateEgressTokenRequest(request); err != nil {
			return nil, err
		}
		return &EgressTokenControlMessage{Request: &request}, nil
	case "egress.token.response":
		var response EgressTokenResponse
		if err := decodeEgressTokenStrict([]byte(payload), &response); err != nil {
			return nil, err
		}
		if err := ValidateEgressTokenResponse(response); err != nil {
			return nil, err
		}
		return &EgressTokenControlMessage{Response: &response}, nil
	case "egress.token.error":
		var tokenError EgressTokenError
		if err := decodeEgressTokenStrict([]byte(payload), &tokenError); err != nil {
			return nil, err
		}
		if err := ValidateEgressTokenError(tokenError); err != nil {
			return nil, err
		}
		return &EgressTokenControlMessage{Error: &tokenError}, nil
	default:
		return nil, nil
	}
}

func ValidateEgressTokenRequest(message EgressTokenRequest) error {
	if message.MessageType != "egress.token.request" {
		return fmt.Errorf("egress.token.request message type must be 'egress.token.request'")
	}
	if strings.TrimSpace(message.RequestID) == "" {
		return fmt.Errorf("egress.token.request requestId is required")
	}
	if message.ActingUserID != nil && strings.TrimSpace(*message.ActingUserID) == "" {
		return fmt.Errorf("egress.token.request actingUserId cannot be empty when provided")
	}
	return nil
}

func ValidateEgressTokenResponse(message EgressTokenResponse) error {
	if message.MessageType != "egress.token.response" {
		return fmt.Errorf("egress.token.response message type must be 'egress.token.response'")
	}
	if strings.TrimSpace(message.RequestID) == "" {
		return fmt.Errorf("egress.token.response requestId is required")
	}
	if strings.TrimSpace(message.Token) == "" {
		return fmt.Errorf("egress.token.response token is required")
	}
	if strings.TrimSpace(message.ExpiresAt) == "" {
		return fmt.Errorf("egress.token.response expiresAt is required")
	}
	if message.TTLMS == 0 {
		return fmt.Errorf("egress.token.response ttlMs is required")
	}
	return nil
}

func ValidateEgressTokenError(message EgressTokenError) error {
	if message.MessageType != "egress.token.error" {
		return fmt.Errorf("egress.token.error message type must be 'egress.token.error'")
	}
	if strings.TrimSpace(message.RequestID) == "" {
		return fmt.Errorf("egress.token.error requestId is required")
	}
	if strings.TrimSpace(message.Code) == "" {
		return fmt.Errorf("egress.token.error code is required")
	}
	if strings.TrimSpace(message.Message) == "" {
		return fmt.Errorf("egress.token.error message is required")
	}
	return nil
}

func decodeEgressTokenStrict(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != nil {
		if err == io.EOF {
			return nil
		}
		return err
	}
	return fmt.Errorf("unexpected trailing JSON data")
}
