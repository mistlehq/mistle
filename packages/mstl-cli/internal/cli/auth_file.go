package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	authFileName  = "auth.json"
	configDirName = "mistle"
)

type authFile struct {
	AuthMode string     `json:"authMode"`
	APIKey   *string    `json:"apiKey,omitempty"`
	OAuth    *oauthAuth `json:"oauth,omitempty"`
}

type oauthAuth struct {
	AccessToken          string `json:"accessToken"`
	RefreshToken         string `json:"refreshToken"`
	ExpiresAtUnixSeconds uint64 `json:"expiresAt"`
	Scope                string `json:"scope"`
}

type authCredential struct {
	APIKey *string
	OAuth  *oauthAuth
}

func readAuthCredential() (authCredential, error) {
	return readAuthCredentialFromPath(defaultAuthFilePath())
}

func readAuthCredentialFromPath(path string) (authCredential, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return authCredential{}, errMissingAuthFile
		}
		return authCredential{}, fmt.Errorf("failed to read auth file `%s`: %w", path, err)
	}

	var file authFile
	if err := json.Unmarshal(contents, &file); err != nil {
		return authCredential{}, fmt.Errorf("failed to parse auth file `%s`: %w", path, err)
	}

	switch file.AuthMode {
	case "api_key":
		if file.APIKey == nil {
			return authCredential{}, fmt.Errorf("invalid auth file `%s`: apiKey is required when authMode is api_key", path)
		}
		apiKey := strings.TrimSpace(*file.APIKey)
		if apiKey == "" {
			return authCredential{}, fmt.Errorf("invalid auth file `%s`: apiKey cannot be blank", path)
		}
		return authCredential{APIKey: &apiKey}, nil
	case "oauth":
		if file.OAuth == nil {
			return authCredential{}, fmt.Errorf("invalid auth file `%s`: oauth is required when authMode is oauth", path)
		}
		if strings.TrimSpace(file.OAuth.AccessToken) == "" {
			return authCredential{}, fmt.Errorf("invalid auth file `%s`: oauth.accessToken cannot be blank", path)
		}
		if strings.TrimSpace(file.OAuth.RefreshToken) == "" {
			return authCredential{}, fmt.Errorf("invalid auth file `%s`: oauth.refreshToken cannot be blank", path)
		}
		if strings.TrimSpace(file.OAuth.Scope) == "" {
			return authCredential{}, fmt.Errorf("invalid auth file `%s`: oauth.scope cannot be blank", path)
		}
		return authCredential{OAuth: file.OAuth}, nil
	default:
		return authCredential{}, fmt.Errorf("invalid auth file `%s`: unsupported authMode %q", path, file.AuthMode)
	}
}

func defaultAuthFilePath() string {
	configHome := os.Getenv("XDG_CONFIG_HOME")
	if strings.TrimSpace(configHome) == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return filepath.Join(configDirName, authFileName)
		}
		configHome = filepath.Join(home, ".config")
	}
	return filepath.Join(configHome, configDirName, authFileName)
}
