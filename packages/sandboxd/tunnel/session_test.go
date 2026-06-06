package tunnel

import "testing"

func TestDeriveSandboxInstanceIDUsesLastNonEmptyPathSegment(t *testing.T) {
	sandboxInstanceID, err := DeriveSandboxInstanceID("wss://gateway.example.test/tunnel/sandbox/sbi_123?x-mistle-test-environment-id=test_env")
	requireNoError(t, err)

	assertEqual(t, sandboxInstanceID, "sbi_123")
}

func TestDeriveSandboxInstanceIDRejectsInvalidGatewayURLs(t *testing.T) {
	for _, input := range []struct {
		name     string
		rawURL   string
		expected string
	}{
		{name: "invalid", rawURL: "://bad", expected: "tunnel gateway url is invalid:"},
		{name: "relative", rawURL: "/tunnel/sandbox/sbi_123", expected: "tunnel gateway url is invalid: absolute ws url is required"},
		{name: "no path", rawURL: "wss://gateway.example.test/", expected: "tunnel gateway url must end with the sandbox instance id path segment"},
	} {
		t.Run(input.name, func(t *testing.T) {
			_, err := DeriveSandboxInstanceID(input.rawURL)

			if err == nil {
				t.Fatalf("expected invalid gateway url to fail")
			}
			if len(err.Error()) < len(input.expected) || err.Error()[:len(input.expected)] != input.expected {
				t.Fatalf("expected error prefix %q, got %q", input.expected, err.Error())
			}
		})
	}
}
