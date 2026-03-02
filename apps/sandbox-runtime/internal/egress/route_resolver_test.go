package egress

import (
	"errors"
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

func buildRuntimePlanForResolverTests() startup.RuntimePlan {
	return startup.RuntimePlan{
		SandboxProfileID: "sbp_test",
		Version:          1,
		Image: startup.ResolvedSandboxImage{
			Source:   "base",
			ImageRef: "mistle/sandbox-base:dev",
		},
		EgressRoutes: []startup.EgressCredentialRoute{
			{
				RouteID:   "route_openai",
				BindingID: "ibd_openai",
				Match: startup.EgressRouteMatch{
					Hosts:        []string{"api.openai.com"},
					PathPrefixes: []string{"/v1"},
					Methods:      []string{"POST"},
				},
				Upstream: startup.EgressRouteUpstream{BaseURL: "https://api.openai.com/v1"},
				AuthInjection: startup.EgressAuthInjection{
					Type:   "bearer",
					Target: "authorization",
				},
				CredentialResolver: startup.EgressCredentialResolver{
					ConnectionID: "icn_openai",
					SecretType:   "api_key",
				},
			},
		},
		Artifacts:           []startup.RuntimeArtifactSpec{},
		RuntimeClientSetups: []startup.RuntimeClientSetup{},
	}
}

func TestResolverResolveRoute(t *testing.T) {
	resolver := NewResolver(NewResolverInput{RuntimePlan: buildRuntimePlanForResolverTests()})

	t.Run("resolves route when method and path are allowed", func(t *testing.T) {
		route, err := resolver.ResolveRoute(ResolveRouteInput{
			RouteID:    "route_openai",
			Method:     "POST",
			TargetPath: "/v1/responses",
		})
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if route.RouteID != "route_openai" {
			t.Fatalf("expected route route_openai, got %s", route.RouteID)
		}
	})

	t.Run("fails when route does not exist", func(t *testing.T) {
		_, err := resolver.ResolveRoute(ResolveRouteInput{
			RouteID:    "route_missing",
			Method:     "POST",
			TargetPath: "/v1/responses",
		})
		if err == nil {
			t.Fatal("expected route not found error")
		}

		var routeMatchError RouteMatchError
		if !errors.As(err, &routeMatchError) {
			t.Fatalf("expected RouteMatchError, got %T", err)
		}
		if routeMatchError.Code != RouteMatchErrorCodeRouteNotFound {
			t.Fatalf("expected route_not_found, got %s", routeMatchError.Code)
		}
	})

	t.Run("fails when method is not allowed", func(t *testing.T) {
		_, err := resolver.ResolveRoute(ResolveRouteInput{
			RouteID:    "route_openai",
			Method:     "GET",
			TargetPath: "/v1/responses",
		})
		if err == nil {
			t.Fatal("expected method forbidden error")
		}

		var routeMatchError RouteMatchError
		if !errors.As(err, &routeMatchError) {
			t.Fatalf("expected RouteMatchError, got %T", err)
		}
		if routeMatchError.Code != RouteMatchErrorCodeMethodForbidden {
			t.Fatalf("expected method_forbidden, got %s", routeMatchError.Code)
		}
	})

	t.Run("fails when path is not allowed", func(t *testing.T) {
		_, err := resolver.ResolveRoute(ResolveRouteInput{
			RouteID:    "route_openai",
			Method:     "POST",
			TargetPath: "/v2/responses",
		})
		if err == nil {
			t.Fatal("expected path forbidden error")
		}

		var routeMatchError RouteMatchError
		if !errors.As(err, &routeMatchError) {
			t.Fatalf("expected RouteMatchError, got %T", err)
		}
		if routeMatchError.Code != RouteMatchErrorCodePathForbidden {
			t.Fatalf("expected path_forbidden, got %s", routeMatchError.Code)
		}
	})
}
