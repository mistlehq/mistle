package bootstrap

import (
	"fmt"
	"path/filepath"
	"strings"
)

const DefaultSandboxUser = "sandbox"
const SandboxUserEnv = "SANDBOX_USER"
const ProxyCACertPathEnv = "SANDBOX_RUNTIME_PROXY_CA_CERT_PATH"
const ProxyCACertInstallPath = "/usr/local/share/ca-certificates/mistle-proxy-ca.crt"

type Config struct {
	SandboxUser     string
	ProxyCACertPath string
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

	proxyCACertPath := ""
	if rawProxyCACertPath, ok := lookupEnv(ProxyCACertPathEnv); ok {
		trimmedProxyCACertPath := strings.TrimSpace(rawProxyCACertPath)
		if trimmedProxyCACertPath != "" {
			if !filepath.IsAbs(trimmedProxyCACertPath) {
				return Config{}, fmt.Errorf("%s must be an absolute path", ProxyCACertPathEnv)
			}
			proxyCACertPath = filepath.Clean(trimmedProxyCACertPath)
		}
	}

	return Config{
		SandboxUser:     sandboxUser,
		ProxyCACertPath: proxyCACertPath,
	}, nil
}
