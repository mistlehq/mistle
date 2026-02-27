package config

import "testing"

func TestLoadFromEnv(t *testing.T) {
	t.Run("loads listen address when present", func(t *testing.T) {
		cfg, err := LoadFromEnv(func(key string) (string, bool) {
			if key == ListenAddrEnv {
				return ":8090", true
			}

			return "", false
		})
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if cfg.ListenAddr != ":8090" {
			t.Fatalf("expected listen addr to be :8090, got %s", cfg.ListenAddr)
		}
	})

	t.Run("fails when variable is missing", func(t *testing.T) {
		_, err := LoadFromEnv(func(string) (string, bool) {
			return "", false
		})
		if err == nil {
			t.Fatal("expected error when listen address is missing")
		}
	})

	t.Run("fails when variable is empty", func(t *testing.T) {
		_, err := LoadFromEnv(func(string) (string, bool) {
			return "", true
		})
		if err == nil {
			t.Fatal("expected error when listen address is empty")
		}
	})
}
