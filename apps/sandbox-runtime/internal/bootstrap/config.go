package bootstrap

import (
	"fmt"
	"strings"
)

const DefaultSandboxUser = "sandbox"
const SandboxUserEnv = "SANDBOX_USER"
const ProxyCACertInstallPath = "/usr/local/share/ca-certificates/mistle-proxy-ca.crt"

type Config struct {
	SandboxUser string
}

func LoadConfig(lookupEnv func(string) (string, bool)) (Config, error) {
	if lookupEnv == nil {
		return Config{}, fmt.Errorf("lookupEnv is required")
	}

	sandboxUser := DefaultSandboxUser
	if rawSandboxUser, ok := lookupEnv(SandboxUserEnv); ok {
		trimmedSandboxUser := strings.TrimSpace(rawSandboxUser)
		if trimmedSandboxUser == "" {
			return Config{}, fmt.Errorf("%s must not be empty when set", SandboxUserEnv)
		}
		if trimmedSandboxUser != DefaultSandboxUser {
			return Config{}, fmt.Errorf(
				"%s is reserved and must be %q",
				SandboxUserEnv,
				DefaultSandboxUser,
			)
		}
		sandboxUser = trimmedSandboxUser
	}

	return Config{
		SandboxUser: sandboxUser,
	}, nil
}
