package startup

import (
	"strings"
	"testing"
)

func TestValidateRuntimeClientProcessReadiness(t *testing.T) {
	t.Run("accepts ws readiness with ws scheme", func(t *testing.T) {
		err := validateRuntimeClientProcessReadiness(
			RuntimeClientProcessReadiness{
				Type:      "ws",
				URL:       "ws://127.0.0.1:4747/mcp",
				TimeoutMs: 5000,
			},
			0,
		)
		if err != nil {
			t.Fatalf("expected ws readiness validation to succeed, got %v", err)
		}
	})

	t.Run("rejects ws readiness with non-ws scheme", func(t *testing.T) {
		err := validateRuntimeClientProcessReadiness(
			RuntimeClientProcessReadiness{
				Type:      "ws",
				URL:       "http://127.0.0.1:4747/mcp",
				TimeoutMs: 5000,
			},
			0,
		)
		if err == nil {
			t.Fatal("expected ws readiness validation to fail for non-ws scheme")
		}
		if !strings.Contains(err.Error(), "must use ws or wss scheme") {
			t.Fatalf("expected ws scheme validation error, got %v", err)
		}
	})
}
