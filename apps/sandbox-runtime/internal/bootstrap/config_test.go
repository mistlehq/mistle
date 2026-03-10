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
		if config.ProxyCACertPath != "" {
			t.Fatalf("expected empty proxy ca cert path, got %q", config.ProxyCACertPath)
		}
	})

	t.Run("trims and keeps an absolute proxy ca cert path", func(t *testing.T) {
		config, err := LoadConfig(func(key string) (string, bool) {
			switch key {
			case SandboxUserEnv:
				return " sandbox-user ", true
			case ProxyCACertPathEnv:
				return " /run/mistle/proxy-ca/ca.crt ", true
			default:
				return "", false
			}
		})
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if config.SandboxUser != "sandbox-user" {
			t.Fatalf("expected trimmed sandbox user, got %q", config.SandboxUser)
		}
		if config.ProxyCACertPath != "/run/mistle/proxy-ca/ca.crt" {
			t.Fatalf("expected trimmed proxy ca cert path, got %q", config.ProxyCACertPath)
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

	t.Run("rejects a relative proxy ca cert path", func(t *testing.T) {
		_, err := LoadConfig(func(key string) (string, bool) {
			if key == ProxyCACertPathEnv {
				return "proxy-ca/ca.crt", true
			}
			return "", false
		})
		if err == nil {
			t.Fatal("expected error for relative proxy ca cert path")
		}
	})
}
