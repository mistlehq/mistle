package bootstrap

import "testing"

func TestLoadConfig(t *testing.T) {
	t.Run("uses default sandbox user when env is absent", func(t *testing.T) {
		config, err := LoadConfig(func(string) (string, bool) {
			return "", false
		})
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if config.SandboxUser != DefaultSandboxUser {
			t.Fatalf("expected sandbox user %q, got %q", DefaultSandboxUser, config.SandboxUser)
		}
	})

	t.Run("rejects an empty sandbox user when env is set", func(t *testing.T) {
		_, err := LoadConfig(func(key string) (string, bool) {
			if key == SandboxUserEnv {
				return "   ", true
			}
			return "", false
		})
		if err == nil {
			t.Fatal("expected error for empty sandbox user")
		}
	})

	t.Run("rejects a non-default sandbox user override", func(t *testing.T) {
		_, err := LoadConfig(func(key string) (string, bool) {
			if key == SandboxUserEnv {
				return "root", true
			}
			return "", false
		})
		if err == nil {
			t.Fatal("expected error for non-default sandbox user")
		}
	})
}
