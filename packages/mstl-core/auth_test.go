package mstlcore

import "testing"

func TestAPIKeyAuthStatusReportsAuthenticatedWhenAPIKeyHasContent(t *testing.T) {
	apiKey := "mstl_test_key"

	if APIKeyAuthStatus(&apiKey) != AuthStatusAuthenticated {
		t.Fatalf("expected API key with content to be authenticated")
	}
}

func TestAPIKeyAuthStatusReportsUnauthenticatedWhenAPIKeyIsAbsent(t *testing.T) {
	if APIKeyAuthStatus(nil) != AuthStatusUnauthenticated {
		t.Fatalf("expected absent API key to be unauthenticated")
	}
}

func TestAPIKeyAuthStatusReportsUnauthenticatedWhenAPIKeyIsBlank(t *testing.T) {
	apiKey := "  "

	if APIKeyAuthStatus(&apiKey) != AuthStatusUnauthenticated {
		t.Fatalf("expected blank API key to be unauthenticated")
	}
}
