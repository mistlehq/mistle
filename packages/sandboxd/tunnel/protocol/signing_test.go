package protocol

import "testing"

func TestSigningRequestPayloadMatchesTunnelContract(t *testing.T) {
	integrationConnectionID := "icn_github"
	payload, err := SigningRequestPayload(SigningRequest{
		MessageType:             "signing.request",
		RequestID:               "sign_req_123",
		OrganizationID:          "org_123",
		SandboxInstanceID:       "sbi_123",
		ActingUserID:            "usr_123",
		ProviderFamily:          "github",
		IntegrationConnectionID: &integrationConnectionID,
		Format:                  "ssh",
		KeyRef:                  "key::ssh-ed25519 AAAA",
		Grant:                   "grant-token",
		Payload:                 "c2lnbi1tZQ==",
		Encoding:                "base64",
	})
	requireNoError(t, err)

	assertEqual(t, payload, `{"type":"signing.request","requestId":"sign_req_123","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","integrationConnectionId":"icn_github","format":"ssh","keyRef":"key::ssh-ed25519 AAAA","grant":"grant-token","payload":"c2lnbi1tZQ==","encoding":"base64"}`)
}

func TestSigningRequestPayloadOmitsMissingIntegrationConnectionID(t *testing.T) {
	payload, err := SigningRequestPayload(SigningRequest{
		MessageType:       "signing.request",
		RequestID:         "sign_req_123",
		OrganizationID:    "org_123",
		SandboxInstanceID: "sbi_123",
		ActingUserID:      "usr_123",
		ProviderFamily:    "github",
		Format:            "ssh",
		KeyRef:            "key::ssh-ed25519 AAAA",
		Grant:             "grant-token",
		Payload:           "c2lnbi1tZQ==",
		Encoding:          "base64",
	})
	requireNoError(t, err)

	assertEqual(t, payload, `{"type":"signing.request","requestId":"sign_req_123","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","format":"ssh","keyRef":"key::ssh-ed25519 AAAA","grant":"grant-token","payload":"c2lnbi1tZQ==","encoding":"base64"}`)
}

func TestParseSigningControlMessages(t *testing.T) {
	request, err := ParseSigningControlMessage(`{"type":"signing.request","requestId":"sign_req_123","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","integrationConnectionId":"icn_github","format":"ssh","keyRef":"key::ssh-ed25519 AAAA","grant":"grant-token","payload":"c2lnbi1tZQ==","encoding":"base64"}`)
	requireNoError(t, err)
	if request == nil || request.Request == nil {
		t.Fatalf("expected signing request")
	}

	success, err := ParseSigningControlMessage(`{"type":"signing.result","requestId":"sign_req_123","ok":true,"signature":"c2lnbmF0dXJl","encoding":"base64"}`)
	requireNoError(t, err)
	if success == nil || success.SuccessResult == nil {
		t.Fatalf("expected signing success result")
	}

	failure, err := ParseSigningControlMessage(`{"type":"signing.result","requestId":"sign_req_123","ok":false,"code":"signing_backend_not_implemented","message":"Git signing backend is not implemented yet."}`)
	requireNoError(t, err)
	if failure == nil || failure.FailureResult == nil {
		t.Fatalf("expected signing failure result")
	}

	ignored, err := ParseSigningControlMessage(`{"type":"egress.token.request","requestId":"req"}`)
	requireNoError(t, err)
	if ignored != nil {
		t.Fatalf("expected unrelated signing control message to be ignored")
	}
}

func TestParseSigningControlMessageRejectsInvalidPayloads(t *testing.T) {
	for _, input := range []struct {
		name     string
		payload  string
		expected string
	}{
		{name: "json", payload: `{`, expected: "signing control message must be valid json:"},
		{name: "ok", payload: `{"type":"signing.result","requestId":"sign_req_123"}`, expected: "signing.result ok flag is required"},
		{name: "request id", payload: `{"type":"signing.request","requestId":"","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","format":"ssh","keyRef":"key","grant":"grant","payload":"cA==","encoding":"base64"}`, expected: "signing.request requestId is required"},
		{name: "connection id", payload: `{"type":"signing.request","requestId":"sign_req_123","organizationId":"org_123","sandboxInstanceId":"sbi_123","actingUserId":"usr_123","providerFamily":"github","integrationConnectionId":"","format":"ssh","keyRef":"key","grant":"grant","payload":"cA==","encoding":"base64"}`, expected: "signing.request integrationConnectionId cannot be empty when provided"},
		{name: "encoding", payload: `{"type":"signing.result","requestId":"sign_req_123","ok":true,"signature":"sig","encoding":"utf8"}`, expected: "successful signing.result encoding must be 'base64'"},
		{name: "failure code", payload: `{"type":"signing.result","requestId":"sign_req_123","ok":false,"code":"","message":"failed"}`, expected: "signing.result code is required"},
	} {
		t.Run(input.name, func(t *testing.T) {
			_, err := ParseSigningControlMessage(input.payload)

			if err == nil {
				t.Fatalf("expected parse error")
			}
			if len(err.Error()) < len(input.expected) || err.Error()[:len(input.expected)] != input.expected {
				t.Fatalf("expected error prefix %q, got %q", input.expected, err.Error())
			}
		})
	}
}
