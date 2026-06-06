package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type SigningRequest struct {
	MessageType             string  `json:"type"`
	RequestID               string  `json:"requestId"`
	OrganizationID          string  `json:"organizationId"`
	SandboxInstanceID       string  `json:"sandboxInstanceId"`
	ActingUserID            string  `json:"actingUserId"`
	ProviderFamily          string  `json:"providerFamily"`
	IntegrationConnectionID *string `json:"integrationConnectionId,omitempty"`
	Format                  string  `json:"format"`
	KeyRef                  string  `json:"keyRef"`
	Grant                   string  `json:"grant"`
	Payload                 string  `json:"payload"`
	Encoding                string  `json:"encoding"`
}

type SigningSuccessResult struct {
	MessageType string `json:"type"`
	RequestID   string `json:"requestId"`
	OK          bool   `json:"ok"`
	Signature   string `json:"signature"`
	Encoding    string `json:"encoding"`
}

type SigningFailureResult struct {
	MessageType string `json:"type"`
	RequestID   string `json:"requestId"`
	OK          bool   `json:"ok"`
	Code        string `json:"code"`
	Message     string `json:"message"`
}

type SigningControlMessage struct {
	Request       *SigningRequest
	SuccessResult *SigningSuccessResult
	FailureResult *SigningFailureResult
}

func SigningRequestPayload(request SigningRequest) (string, error) {
	if err := ValidateSigningRequest(request); err != nil {
		return "", err
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return "", fmt.Errorf("failed to serialize signing.request: %w", err)
	}
	return string(payload), nil
}

func ParseSigningControlMessage(payload string) (*SigningControlMessage, error) {
	var raw struct {
		Type *string `json:"type"`
		OK   *bool   `json:"ok"`
	}
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		return nil, fmt.Errorf("signing control message must be valid json: %w", err)
	}
	if raw.Type == nil {
		return nil, nil
	}
	switch *raw.Type {
	case "signing.request":
		var request SigningRequest
		if err := decodeSigningStrict([]byte(payload), &request); err != nil {
			return nil, err
		}
		if err := ValidateSigningRequest(request); err != nil {
			return nil, err
		}
		return &SigningControlMessage{Request: &request}, nil
	case "signing.result":
		if raw.OK == nil {
			return nil, fmt.Errorf("signing.result ok flag is required")
		}
		if *raw.OK {
			var result SigningSuccessResult
			if err := decodeSigningStrict([]byte(payload), &result); err != nil {
				return nil, err
			}
			if err := ValidateSigningSuccessResult(result); err != nil {
				return nil, err
			}
			return &SigningControlMessage{SuccessResult: &result}, nil
		}
		var result SigningFailureResult
		if err := decodeSigningStrict([]byte(payload), &result); err != nil {
			return nil, err
		}
		if err := ValidateSigningFailureResult(result); err != nil {
			return nil, err
		}
		return &SigningControlMessage{FailureResult: &result}, nil
	default:
		return nil, nil
	}
}

func ValidateSigningRequest(message SigningRequest) error {
	if message.MessageType != "signing.request" {
		return fmt.Errorf("signing.request message type must be 'signing.request'")
	}
	if strings.TrimSpace(message.RequestID) == "" {
		return fmt.Errorf("signing.request requestId is required")
	}
	if strings.TrimSpace(message.OrganizationID) == "" {
		return fmt.Errorf("signing.request organizationId is required")
	}
	if strings.TrimSpace(message.SandboxInstanceID) == "" {
		return fmt.Errorf("signing.request sandboxInstanceId is required")
	}
	if strings.TrimSpace(message.ActingUserID) == "" {
		return fmt.Errorf("signing.request actingUserId is required")
	}
	if strings.TrimSpace(message.ProviderFamily) == "" {
		return fmt.Errorf("signing.request providerFamily is required")
	}
	if message.IntegrationConnectionID != nil && strings.TrimSpace(*message.IntegrationConnectionID) == "" {
		return fmt.Errorf("signing.request integrationConnectionId cannot be empty when provided")
	}
	if strings.TrimSpace(message.Format) == "" {
		return fmt.Errorf("signing.request format is required")
	}
	if strings.TrimSpace(message.KeyRef) == "" {
		return fmt.Errorf("signing.request keyRef is required")
	}
	if strings.TrimSpace(message.Grant) == "" {
		return fmt.Errorf("signing.request grant is required")
	}
	if message.Encoding != "base64" {
		return fmt.Errorf("signing.request encoding must be 'base64'")
	}
	return nil
}

func ValidateSigningSuccessResult(message SigningSuccessResult) error {
	if message.MessageType != "signing.result" {
		return fmt.Errorf("signing.result message type must be 'signing.result'")
	}
	if !message.OK {
		return fmt.Errorf("successful signing.result payload must set ok=true")
	}
	if strings.TrimSpace(message.RequestID) == "" {
		return fmt.Errorf("signing.result requestId is required")
	}
	if message.Encoding != "base64" {
		return fmt.Errorf("successful signing.result encoding must be 'base64'")
	}
	return nil
}

func ValidateSigningFailureResult(message SigningFailureResult) error {
	if message.MessageType != "signing.result" {
		return fmt.Errorf("signing.result message type must be 'signing.result'")
	}
	if message.OK {
		return fmt.Errorf("failed signing.result payload must set ok=false")
	}
	if strings.TrimSpace(message.RequestID) == "" {
		return fmt.Errorf("signing.result requestId is required")
	}
	if strings.TrimSpace(message.Code) == "" {
		return fmt.Errorf("signing.result code is required")
	}
	if strings.TrimSpace(message.Message) == "" {
		return fmt.Errorf("signing.result message is required")
	}
	return nil
}

func decodeSigningStrict(data []byte, target any) error {
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
