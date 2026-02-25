package config

import (
	"errors"
	"os"
)

var ErrMissingListenAddr = errors.New("SANDBOX_RUNTIME_LISTEN_ADDR is required")

type Config struct {
	ListenAddr string
}

func LoadFromEnv() (Config, error) {
	listenAddr := os.Getenv("SANDBOX_RUNTIME_LISTEN_ADDR")
	if listenAddr == "" {
		return Config{}, ErrMissingListenAddr
	}

	return Config{ListenAddr: listenAddr}, nil
}
