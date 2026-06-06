package control

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"

	"github.com/mistle/sandboxd/protocol"
)

type RequestType string

const (
	RequestReady    RequestType = "ready"
	RequestShutdown RequestType = "shutdown"
	RequestActivate RequestType = "activate"
	RequestSign     RequestType = "sign"
)

type Request struct {
	Type            RequestType
	ActivationInput *protocol.ActivationInput
	SignRequest     *SignRequest
}

type SignRequest struct {
	KeyRef        string `json:"keyRef"`
	PayloadBase64 string `json:"payloadBase64"`
}

type Response struct {
	OK              bool    `json:"ok"`
	Error           *string `json:"error"`
	SignatureBase64 *string `json:"signatureBase64"`
}

func DecodeRequest(data []byte) (Request, error) {
	var raw struct {
		Type            RequestType               `json:"type"`
		ActivationInput *protocol.ActivationInput `json:"activationInput"`
		SignRequest     *SignRequest              `json:"signRequest"`
	}
	if err := decodeStrict(data, &raw); err != nil {
		return Request{}, fmt.Errorf("control socket request must be valid json: %w", err)
	}
	switch raw.Type {
	case RequestReady, RequestShutdown:
		if raw.ActivationInput != nil || raw.SignRequest != nil {
			return Request{}, fmt.Errorf("control %s request must not include a payload", raw.Type)
		}
	case RequestActivate:
		if raw.ActivationInput == nil {
			return Request{}, fmt.Errorf("control activate request must include activationInput")
		}
		if raw.SignRequest != nil {
			return Request{}, fmt.Errorf("control activate request must not include signRequest")
		}
	case RequestSign:
		if raw.SignRequest == nil {
			return Request{}, fmt.Errorf("control sign request must include signRequest")
		}
		if raw.ActivationInput != nil {
			return Request{}, fmt.Errorf("control sign request must not include activationInput")
		}
	default:
		return Request{}, fmt.Errorf("unsupported control request type: %s", raw.Type)
	}
	return Request{
		Type:            raw.Type,
		ActivationInput: raw.ActivationInput,
		SignRequest:     raw.SignRequest,
	}, nil
}

func (request Request) MarshalJSON() ([]byte, error) {
	payload := map[string]any{"type": request.Type}
	switch request.Type {
	case RequestReady, RequestShutdown:
		if request.ActivationInput != nil || request.SignRequest != nil {
			return nil, fmt.Errorf("control %s request must not include a payload", request.Type)
		}
	case RequestActivate:
		if request.ActivationInput == nil {
			return nil, fmt.Errorf("control activate request must include activationInput")
		}
		payload["activationInput"] = request.ActivationInput
	case RequestSign:
		if request.SignRequest == nil {
			return nil, fmt.Errorf("control sign request must include signRequest")
		}
		payload["signRequest"] = request.SignRequest
	default:
		return nil, fmt.Errorf("unsupported control request type: %s", request.Type)
	}
	return json.Marshal(payload)
}

func OKResponse(signatureBase64 *string) Response {
	return Response{OK: true, SignatureBase64: signatureBase64}
}

func ErrorResponse(message string) Response {
	return Response{OK: false, Error: &message}
}

func DecodeResponse(data []byte) (Response, error) {
	var response Response
	if err := decodeStrict(data, &response); err != nil {
		return Response{}, fmt.Errorf("control socket response must be valid json: %w", err)
	}
	if response.OK {
		if response.Error != nil {
			return Response{}, fmt.Errorf("control success response must not contain error")
		}
		return response, nil
	}
	if response.Error == nil || *response.Error == "" {
		return Response{}, fmt.Errorf("control error response must contain a non-empty error")
	}
	if response.SignatureBase64 != nil {
		return Response{}, fmt.Errorf("control error response must not contain signatureBase64")
	}
	return response, nil
}

func decodeStrict(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return fmt.Errorf("unexpected trailing JSON data")
		}
		return fmt.Errorf("unexpected trailing JSON data")
	}
	return nil
}
