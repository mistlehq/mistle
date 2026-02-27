package bootstrap

import (
	"bytes"
	"testing"
)

func TestReadBootstrapToken(t *testing.T) {
	t.Run("reads token from stdin bytes", func(t *testing.T) {
		token, err := ReadBootstrapToken(ReadBootstrapTokenInput{
			Reader:   bytes.NewBufferString("test-token"),
			MaxBytes: 1024,
		})
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if string(token) != "test-token" {
			t.Fatalf("expected token test-token, got %q", string(token))
		}
	})

	t.Run("trims surrounding whitespace", func(t *testing.T) {
		token, err := ReadBootstrapToken(ReadBootstrapTokenInput{
			Reader:   bytes.NewBufferString("\n  test-token  \n"),
			MaxBytes: 1024,
		})
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if string(token) != "test-token" {
			t.Fatalf("expected token test-token, got %q", string(token))
		}
	})

	t.Run("fails when reader is missing", func(t *testing.T) {
		_, err := ReadBootstrapToken(ReadBootstrapTokenInput{MaxBytes: 1024})
		if err == nil {
			t.Fatal("expected error when reader is missing")
		}
	})

	t.Run("fails when max bytes is invalid", func(t *testing.T) {
		_, err := ReadBootstrapToken(ReadBootstrapTokenInput{
			Reader:   bytes.NewBufferString("test-token"),
			MaxBytes: 0,
		})
		if err == nil {
			t.Fatal("expected error when max bytes is invalid")
		}
	})

	t.Run("fails when stdin is empty", func(t *testing.T) {
		_, err := ReadBootstrapToken(ReadBootstrapTokenInput{
			Reader:   bytes.NewBufferString("\n \t\n"),
			MaxBytes: 1024,
		})
		if err == nil {
			t.Fatal("expected error when token is empty")
		}
	})

	t.Run("fails when token exceeds max bytes", func(t *testing.T) {
		_, err := ReadBootstrapToken(ReadBootstrapTokenInput{
			Reader:   bytes.NewBufferString("abcdef"),
			MaxBytes: 3,
		})
		if err == nil {
			t.Fatal("expected error when token exceeds max bytes")
		}
	})
}
