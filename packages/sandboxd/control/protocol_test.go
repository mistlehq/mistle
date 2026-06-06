package control

import (
	"encoding/json"
	"testing"

	"github.com/mistle/sandboxd/protocol"
)

func TestDecodesReadyAndShutdownControlRequests(t *testing.T) {
	readyRequest, err := DecodeRequest([]byte(`{"type":"ready"}`))
	requireNoError(t, err)
	assertEqual(t, readyRequest.Type, RequestReady)

	shutdownRequest, err := DecodeRequest([]byte(`{"type":"shutdown"}`))
	requireNoError(t, err)
	assertEqual(t, shutdownRequest.Type, RequestShutdown)
}

func TestDecodesActivateControlRequest(t *testing.T) {
	request, err := DecodeRequest([]byte(`{
		"type": "activate",
		"activationInput": {
			"operationKind": "start",
			"bootstrapToken": "bootstrap-token",
			"tunnelExchangeToken": "exchange-token",
			"tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox/sbi_test",
			"runtimePlan": {"version": 1},
			"actingUserId": null,
			"gitIdentity": null
		}
	}`))
	requireNoError(t, err)

	assertEqual(t, request.Type, RequestActivate)
	assertEqual(t, request.ActivationInput.OperationKind, protocol.ActivationOperationStart)
	assertEqual(t, request.ActivationInput.BootstrapToken, "bootstrap-token")
}

func TestDecodesSignControlRequest(t *testing.T) {
	request, err := DecodeRequest([]byte(`{
		"type": "sign",
		"signRequest": {
			"keyRef": "ssh-ed25519:abc",
			"payloadBase64": "cGF5bG9hZA=="
		}
	}`))
	requireNoError(t, err)

	assertEqual(t, request.Type, RequestSign)
	assertEqual(t, request.SignRequest.KeyRef, "ssh-ed25519:abc")
	assertEqual(t, request.SignRequest.PayloadBase64, "cGF5bG9hZA==")
}

func TestRejectsInvalidControlRequestPayloadCombinations(t *testing.T) {
	_, missingActivationErr := DecodeRequest([]byte(`{"type":"activate"}`))
	if missingActivationErr == nil {
		t.Fatalf("expected missing activation input to fail")
	}
	assertEqual(t, missingActivationErr.Error(), "control activate request must include activationInput")

	_, extraPayloadErr := DecodeRequest([]byte(`{"type":"ready","signRequest":{"keyRef":"key","payloadBase64":"payload"}}`))
	if extraPayloadErr == nil {
		t.Fatalf("expected extra ready payload to fail")
	}
	assertEqual(t, extraPayloadErr.Error(), "control ready request must not include a payload")
}

func TestRejectsUnknownControlRequestFields(t *testing.T) {
	_, err := DecodeRequest([]byte(`{"type":"ready","unexpected":true}`))
	if err == nil {
		t.Fatalf("expected unknown request field to fail")
	}
	assertEqual(t, err.Error(), "control socket request must be valid json: json: unknown field \"unexpected\"")
}

func TestMarshalsControlRequestVariants(t *testing.T) {
	signRequest := Request{
		Type:        RequestSign,
		SignRequest: &SignRequest{KeyRef: "ssh-ed25519:abc", PayloadBase64: "cGF5bG9hZA=="},
	}

	encoded, err := json.Marshal(signRequest)
	requireNoError(t, err)

	var payload map[string]any
	requireNoError(t, json.Unmarshal(encoded, &payload))
	assertEqual(t, payload["type"].(string), "sign")
	signPayload := payload["signRequest"].(map[string]any)
	assertEqual(t, signPayload["keyRef"].(string), "ssh-ed25519:abc")
}

func TestDecodesControlResponses(t *testing.T) {
	signature := "c2lnbmF0dXJl"
	okResponse, err := DecodeResponse([]byte(`{"ok":true,"error":null,"signatureBase64":"c2lnbmF0dXJl"}`))
	requireNoError(t, err)
	assertEqual(t, okResponse.OK, true)
	assertEqual(t, *okResponse.SignatureBase64, signature)

	errorResponse, err := DecodeResponse([]byte(`{"ok":false,"error":"not ready","signatureBase64":null}`))
	requireNoError(t, err)
	assertEqual(t, errorResponse.OK, false)
	assertEqual(t, *errorResponse.Error, "not ready")
}

func TestValidatesControlResponseShape(t *testing.T) {
	_, successWithErrorErr := DecodeResponse([]byte(`{"ok":true,"error":"bad","signatureBase64":null}`))
	if successWithErrorErr == nil {
		t.Fatalf("expected success response with error to fail")
	}
	assertEqual(t, successWithErrorErr.Error(), "control success response must not contain error")

	_, errorWithoutMessageErr := DecodeResponse([]byte(`{"ok":false,"error":"","signatureBase64":null}`))
	if errorWithoutMessageErr == nil {
		t.Fatalf("expected empty error response to fail")
	}
	assertEqual(t, errorWithoutMessageErr.Error(), "control error response must contain a non-empty error")
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
