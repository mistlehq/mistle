package bootstrap

import (
	"bytes"
	"testing"
)

func TestReadStartupInput(t *testing.T) {
	t.Run("reads startup input from stdin bytes", func(t *testing.T) {
		startupInput, err := ReadStartupInput(ReadStartupInputInput{
			Reader:   bytes.NewBufferString(`{"bootstrapToken":"test-token","tunnelGatewayWsUrl":"ws://127.0.0.1:5003/tunnel/sandbox"}`),
			MaxBytes: 1024,
		})
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if startupInput.BootstrapToken != "test-token" {
			t.Fatalf("expected bootstrap token test-token, got %q", startupInput.BootstrapToken)
		}

		if startupInput.TunnelGatewayURL != "ws://127.0.0.1:5003/tunnel/sandbox" {
			t.Fatalf("expected tunnel gateway ws url to match, got %q", startupInput.TunnelGatewayURL)
		}
	})

	t.Run("trims surrounding whitespace", func(t *testing.T) {
		startupInput, err := ReadStartupInput(ReadStartupInputInput{
			Reader: bytes.NewBufferString(`
				{
					"bootstrapToken": "  test-token  ",
					"tunnelGatewayWsUrl": "  ws://127.0.0.1:5003/tunnel/sandbox  "
				}
			`),
			MaxBytes: 1024,
		})
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if startupInput.BootstrapToken != "test-token" {
			t.Fatalf("expected bootstrap token test-token, got %q", startupInput.BootstrapToken)
		}

		if startupInput.TunnelGatewayURL != "ws://127.0.0.1:5003/tunnel/sandbox" {
			t.Fatalf("expected tunnel gateway ws url to match, got %q", startupInput.TunnelGatewayURL)
		}
	})

	t.Run("fails when reader is missing", func(t *testing.T) {
		_, err := ReadStartupInput(ReadStartupInputInput{MaxBytes: 1024})
		if err == nil {
			t.Fatal("expected error when reader is missing")
		}
	})

	t.Run("fails when max bytes is invalid", func(t *testing.T) {
		_, err := ReadStartupInput(ReadStartupInputInput{
			Reader:   bytes.NewBufferString(`{"bootstrapToken":"test-token","tunnelGatewayWsUrl":"ws://127.0.0.1:5003/tunnel/sandbox"}`),
			MaxBytes: 0,
		})
		if err == nil {
			t.Fatal("expected error when max bytes is invalid")
		}
	})

	t.Run("fails when stdin is empty", func(t *testing.T) {
		_, err := ReadStartupInput(ReadStartupInputInput{
			Reader:   bytes.NewBufferString("\n \t\n"),
			MaxBytes: 1024,
		})
		if err == nil || err.Error() != "startup input from stdin is empty" {
			t.Fatalf("expected empty startup input error, got %v", err)
		}
	})

	t.Run("fails when startup input exceeds max bytes", func(t *testing.T) {
		_, err := ReadStartupInput(ReadStartupInputInput{
			Reader:   bytes.NewBufferString(`{"bootstrapToken":"abcdef","tunnelGatewayWsUrl":"ws://127.0.0.1:5003/tunnel/sandbox"}`),
			MaxBytes: 3,
		})
		if err == nil {
			t.Fatal("expected error when startup input exceeds max bytes")
		}
	})

	t.Run("fails when startup input is invalid json", func(t *testing.T) {
		_, err := ReadStartupInput(ReadStartupInputInput{
			Reader:   bytes.NewBufferString("not-json"),
			MaxBytes: 1024,
		})
		if err == nil {
			t.Fatal("expected error when startup input is invalid json")
		}
	})

	t.Run("fails when bootstrap token is missing", func(t *testing.T) {
		_, err := ReadStartupInput(ReadStartupInputInput{
			Reader:   bytes.NewBufferString(`{"tunnelGatewayWsUrl":"ws://127.0.0.1:5003/tunnel/sandbox"}`),
			MaxBytes: 1024,
		})
		if err == nil {
			t.Fatal("expected error when bootstrap token is missing")
		}
	})

	t.Run("fails when tunnel gateway ws url is missing", func(t *testing.T) {
		_, err := ReadStartupInput(ReadStartupInputInput{
			Reader:   bytes.NewBufferString(`{"bootstrapToken":"test-token"}`),
			MaxBytes: 1024,
		})
		if err == nil {
			t.Fatal("expected error when tunnel gateway ws url is missing")
		}
	})
}
