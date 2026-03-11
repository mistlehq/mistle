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
		Artifacts:      []startup.RuntimeArtifactSpec{},
		RuntimeClients: []startup.RuntimeClient{},
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

func TestResolverResolveMatchingRoute(t *testing.T) {
	t.Run("returns a matching route by host method and path", func(t *testing.T) {
		resolver := NewResolver(NewResolverInput{RuntimePlan: buildRuntimePlanForResolverTests()})

		route, matched, err := resolver.ResolveMatchingRoute(ResolveMatchingRouteInput{
			Host:       "api.openai.com:443",
			Method:     "POST",
			TargetPath: "/v1/responses",
		})
		if err != nil {
			t.Fatalf("expected no matching-route error, got %v", err)
		}
		if !matched {
			t.Fatal("expected route to match")
		}
		if route.RouteID != "route_openai" {
			t.Fatalf("expected route_openai, got %s", route.RouteID)
		}
	})

	t.Run("reports no match when host does not match any route", func(t *testing.T) {
		resolver := NewResolver(NewResolverInput{RuntimePlan: buildRuntimePlanForResolverTests()})

		_, matched, err := resolver.ResolveMatchingRoute(ResolveMatchingRouteInput{
			Host:       "api.anthropic.com",
			Method:     "POST",
			TargetPath: "/v1/messages",
		})
		if err != nil {
			t.Fatalf("expected no error for unmatched route, got %v", err)
		}
		if matched {
			t.Fatal("expected route not to match")
		}
	})

	t.Run("fails closed when multiple routes match", func(t *testing.T) {
		runtimePlan := buildRuntimePlanForResolverTests()
		runtimePlan.EgressRoutes = append(runtimePlan.EgressRoutes, startup.EgressCredentialRoute{
			RouteID:   "route_openai_secondary",
			BindingID: "ibd_openai_secondary",
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
				ConnectionID: "icn_openai_secondary",
				SecretType:   "api_key",
			},
		})
		resolver := NewResolver(NewResolverInput{RuntimePlan: runtimePlan})

		_, matched, err := resolver.ResolveMatchingRoute(ResolveMatchingRouteInput{
			Host:       "api.openai.com",
			Method:     "POST",
			TargetPath: "/v1/responses",
		})
		if matched {
			t.Fatal("expected ambiguous matching routes to fail without a match")
		}
		if err == nil {
			t.Fatal("expected ambiguous matching routes to return an error")
		}
	})
}
