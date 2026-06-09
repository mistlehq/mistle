package protocol

import "testing"

func TestEgressTokenRequestPayloadMatchesTunnelContract(t *testing.T) {
	actingUserID := "usr_123"
	payload, err := EgressTokenRequestPayload(EgressTokenRequest{
		MessageType:  "egress.token.request",
		RequestID:    "egress_token_req_1",
		ActingUserID: &actingUserID,
	})
	requireNoError(t, err)
	assertEqual(t, payload, `{"type":"egress.token.request","requestId":"egress_token_req_1","actingUserId":"usr_123"}`)
}

func TestParseEgressTokenControlMessages(t *testing.T) {
	request, err := ParseEgressTokenControlMessage(`{"type":"egress.token.request","requestId":"egress_token_req_1","actingUserId":"usr_123"}`)
	requireNoError(t, err)
	assertEqual(t, request.Request.RequestID, "egress_token_req_1")
	assertEqual(t, *request.Request.ActingUserID, "usr_123")

	response, err := ParseEgressTokenControlMessage(`{"type":"egress.token.response","requestId":"egress_token_req_1","token":"jwt-token","expiresAt":"2026-01-02T03:04:05Z","ttlMs":60000}`)
	requireNoError(t, err)
	assertEqual(t, response.Response.Token, "jwt-token")
	assertEqual(t, response.Response.TTLMS, uint64(60000))

	tokenError, err := ParseEgressTokenControlMessage(`{"type":"egress.token.error","requestId":"egress_token_req_1","code":"forbidden","message":"not allowed"}`)
	requireNoError(t, err)
	assertEqual(t, tokenError.Error.Code, "forbidden")

	ignored, err := ParseEgressTokenControlMessage(`{"type":"signing.request","requestId":"sign_req_1"}`)
	requireNoError(t, err)
	if ignored != nil {
		t.Fatalf("expected non-egress token control message to be ignored")
	}
}

func TestParseEgressTokenControlMessagesAllowFutureFieldsLikeRust(t *testing.T) {
	response, err := ParseEgressTokenControlMessage(`{"type":"egress.token.response","requestId":"egress_token_req_1","token":"jwt-token","expiresAt":"2026-01-02T03:04:05Z","ttlMs":60000,"futureField":{"nested":true}}`)
	requireNoError(t, err)
	if response == nil || response.Response == nil {
		t.Fatalf("expected egress token response")
	}
	assertEqual(t, response.Response.Token, "jwt-token")

	tokenError, err := ParseEgressTokenControlMessage(`{"type":"egress.token.error","requestId":"egress_token_req_1","code":"forbidden","message":"not allowed","futureField":true}`)
	requireNoError(t, err)
	if tokenError == nil || tokenError.Error == nil {
		t.Fatalf("expected egress token error")
	}
	assertEqual(t, tokenError.Error.Code, "forbidden")
}

func TestParseEgressTokenControlMessageRejectsInvalidPayloads(t *testing.T) {
	tests := []struct {
		name    string
		payload string
	}{
		{name: "empty request id", payload: `{"type":"egress.token.request","requestId":""}`},
		{name: "empty acting user", payload: `{"type":"egress.token.request","requestId":"egress_token_req_1","actingUserId":""}`},
		{name: "empty token", payload: `{"type":"egress.token.response","requestId":"egress_token_req_1","token":"","expiresAt":"2026-01-02T03:04:05Z","ttlMs":60000}`},
		{name: "zero ttl", payload: `{"type":"egress.token.response","requestId":"egress_token_req_1","token":"jwt-token","expiresAt":"2026-01-02T03:04:05Z","ttlMs":0}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParseEgressTokenControlMessage(test.payload)
			if err == nil {
				t.Fatalf("expected invalid payload to fail")
			}
		})
	}
}
