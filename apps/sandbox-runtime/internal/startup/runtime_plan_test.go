package startup

import (
	"strings"
	"testing"
)

func TestValidateRuntimePlan(t *testing.T) {
	t.Run("accepts git clone workspace sources with basic auth username", func(t *testing.T) {
		err := ValidateRuntimePlan(RuntimePlan{
			SandboxProfileID: "sbp_123",
			Version:          1,
			Image: ResolvedSandboxImage{
				Source:   "base",
				ImageRef: "mistle/sandbox-base:dev",
			},
			EgressRoutes: []EgressCredentialRoute{
				{
					RouteID:   "route_github_git",
					BindingID: "bind_github",
					Match: EgressRouteMatch{
						Hosts:        []string{"github.com"},
						PathPrefixes: []string{"/mistlehq/mistle.git"},
						Methods:      []string{"GET", "POST"},
					},
					Upstream: EgressRouteUpstream{
						BaseURL: "https://github.com",
					},
					AuthInjection: EgressAuthInjection{
						Type:     "basic",
						Target:   "authorization",
						Username: "x-access-token",
					},
					CredentialResolver: EgressCredentialResolver{
						ConnectionID: "icn_123",
						SecretType:   "oauth_access_token",
						ResolverKey:  "github_app_installation_token",
					},
				},
			},
			Artifacts:        []RuntimeArtifactSpec{},
			ArtifactRemovals: []RuntimeArtifactRemovalSpec{},
			WorkspaceSources: []WorkspaceSource{
				{
					SourceKind:   "git-clone",
					ResourceKind: "repository",
					Path:         "/workspace/repos/mistlehq/mistle",
					OriginURL:    "https://github.com/mistlehq/mistle.git",
					RouteID:      "route_github_git",
				},
			},
			RuntimeClients: []RuntimeClient{},
			AgentRuntimes:  []AgentRuntime{},
		})
		if err != nil {
			t.Fatalf("expected runtime plan validation to succeed, got %v", err)
		}
	})

	t.Run("rejects workspace sources that reference unknown routes", func(t *testing.T) {
		err := ValidateRuntimePlan(RuntimePlan{
			SandboxProfileID: "sbp_123",
			Version:          1,
			Image: ResolvedSandboxImage{
				Source:   "base",
				ImageRef: "mistle/sandbox-base:dev",
			},
			EgressRoutes: []EgressCredentialRoute{
				{
					RouteID:   "route_github_api",
					BindingID: "bind_github",
					Match: EgressRouteMatch{
						Hosts: []string{"api.github.com"},
					},
					Upstream: EgressRouteUpstream{
						BaseURL: "https://api.github.com",
					},
					AuthInjection: EgressAuthInjection{
						Type:   "bearer",
						Target: "authorization",
					},
					CredentialResolver: EgressCredentialResolver{
						ConnectionID: "icn_123",
						SecretType:   "oauth_access_token",
					},
				},
			},
			Artifacts:        []RuntimeArtifactSpec{},
			ArtifactRemovals: []RuntimeArtifactRemovalSpec{},
			WorkspaceSources: []WorkspaceSource{
				{
					SourceKind:   "git-clone",
					ResourceKind: "repository",
					Path:         "/workspace/repos/mistlehq/mistle",
					OriginURL:    "https://github.com/mistlehq/mistle.git",
					RouteID:      "route_missing",
				},
			},
			RuntimeClients: []RuntimeClient{},
			AgentRuntimes:  []AgentRuntime{},
		})
		if err == nil {
			t.Fatal("expected runtime plan validation to fail for unknown workspace source route")
		}
		if !strings.Contains(err.Error(), "does not reference a declared egress route") {
			t.Fatalf("expected unknown route validation error, got %v", err)
		}
	})

	t.Run("rejects auth injection usernames for non-basic auth", func(t *testing.T) {
		err := ValidateRuntimePlan(RuntimePlan{
			SandboxProfileID: "sbp_123",
			Version:          1,
			Image: ResolvedSandboxImage{
				Source:   "base",
				ImageRef: "mistle/sandbox-base:dev",
			},
			EgressRoutes: []EgressCredentialRoute{
				{
					RouteID:   "route_github_api",
					BindingID: "bind_github",
					Match: EgressRouteMatch{
						Hosts: []string{"api.github.com"},
					},
					Upstream: EgressRouteUpstream{
						BaseURL: "https://api.github.com",
					},
					AuthInjection: EgressAuthInjection{
						Type:     "bearer",
						Target:   "authorization",
						Username: "x-access-token",
					},
					CredentialResolver: EgressCredentialResolver{
						ConnectionID: "icn_123",
						SecretType:   "oauth_access_token",
					},
				},
			},
			Artifacts:        []RuntimeArtifactSpec{},
			ArtifactRemovals: []RuntimeArtifactRemovalSpec{},
			WorkspaceSources: []WorkspaceSource{},
			RuntimeClients:   []RuntimeClient{},
			AgentRuntimes:    []AgentRuntime{},
		})
		if err == nil {
			t.Fatal("expected runtime plan validation to fail for non-basic auth usernames")
		}
		if !strings.Contains(err.Error(), "only supported for basic auth injection") {
			t.Fatalf("expected auth injection username validation error, got %v", err)
		}
	})
}

func TestValidateRuntimeClientProcessReadiness(t *testing.T) {
	t.Run("accepts ws readiness with ws scheme", func(t *testing.T) {
		err := validateRuntimeClientProcessReadiness(
			RuntimeClientProcessReadiness{
				Type:      "ws",
				URL:       "ws://127.0.0.1:4500",
				TimeoutMs: 5000,
			},
			0,
			0,
		)
		if err != nil {
			t.Fatalf("expected ws readiness validation to succeed, got %v", err)
		}
	})

	t.Run("rejects ws readiness with non-ws scheme", func(t *testing.T) {
		err := validateRuntimeClientProcessReadiness(
			RuntimeClientProcessReadiness{
				Type:      "ws",
				URL:       "http://127.0.0.1:4500",
				TimeoutMs: 5000,
			},
			0,
			0,
		)
		if err == nil {
			t.Fatal("expected ws readiness validation to fail for non-ws scheme")
		}
		if !strings.Contains(err.Error(), "must use ws or wss scheme") {
			t.Fatalf("expected ws scheme validation error, got %v", err)
		}
	})
}
