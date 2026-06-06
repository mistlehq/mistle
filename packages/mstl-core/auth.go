package mstlcore

import "strings"

const (
	APIKeyEnvVar                   = "MISTLE_API_KEY"
	ControlPlaneAPIPublicURLEnvVar = "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL"
)

type AuthStatus string

const (
	AuthStatusAuthenticated   AuthStatus = "authenticated"
	AuthStatusUnauthenticated AuthStatus = "unauthenticated"
)

func APIKeyAuthStatus(apiKey *string) AuthStatus {
	if apiKey == nil || strings.TrimSpace(*apiKey) == "" {
		return AuthStatusUnauthenticated
	}

	return AuthStatusAuthenticated
}
