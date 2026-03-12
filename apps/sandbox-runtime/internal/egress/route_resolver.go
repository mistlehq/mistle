package egress

import (
	"fmt"
	"net"
	"strings"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type Resolver struct {
	routes []startup.EgressCredentialRoute
}

type NewResolverInput struct {
	RuntimePlan startup.RuntimePlan
}

func NewResolver(input NewResolverInput) Resolver {
	return Resolver{
		routes: input.RuntimePlan.EgressRoutes,
	}
}

type ResolveMatchingRouteInput struct {
	Host       string
	Method     string
	TargetPath string
}

func normalizeTargetPath(targetPath string) string {
	if targetPath == "" {
		return "/"
	}
	if strings.HasPrefix(targetPath, "/") {
		return targetPath
	}
	return "/" + targetPath
}

func containsStringIgnoreCase(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(value, target) {
			return true
		}
	}
	return false
}

func pathMatchesPrefixes(pathPrefixes []string, targetPath string) bool {
	for _, pathPrefix := range pathPrefixes {
		if strings.HasPrefix(targetPath, pathPrefix) {
			return true
		}
	}
	return false
}

func normalizeTargetHost(targetHost string) string {
	trimmedTargetHost := strings.TrimSpace(targetHost)
	if trimmedTargetHost == "" {
		return ""
	}

	host, _, err := net.SplitHostPort(trimmedTargetHost)
	if err == nil {
		return strings.ToLower(host)
	}

	return strings.ToLower(trimmedTargetHost)
}

func hostMatches(route startup.EgressCredentialRoute, targetHost string) bool {
	normalizedTargetHost := normalizeTargetHost(targetHost)
	for _, host := range route.Match.Hosts {
		if strings.EqualFold(host, normalizedTargetHost) {
			return true
		}
	}

	return false
}

func (resolver Resolver) ResolveMatchingRoute(input ResolveMatchingRouteInput) (startup.EgressCredentialRoute, bool, error) {
	normalizedTargetPath := normalizeTargetPath(input.TargetPath)

	matchingRoutes := make([]startup.EgressCredentialRoute, 0, 1)
	for _, route := range resolver.routes {
		if !hostMatches(route, input.Host) {
			continue
		}
		if len(route.Match.Methods) > 0 && !containsStringIgnoreCase(route.Match.Methods, input.Method) {
			continue
		}
		if len(route.Match.PathPrefixes) > 0 && !pathMatchesPrefixes(route.Match.PathPrefixes, normalizedTargetPath) {
			continue
		}

		matchingRoutes = append(matchingRoutes, route)
	}

	if len(matchingRoutes) == 0 {
		return startup.EgressCredentialRoute{}, false, nil
	}
	if len(matchingRoutes) > 1 {
		return startup.EgressCredentialRoute{}, false, fmt.Errorf(
			"multiple egress routes matched host=%q method=%q path=%q",
			normalizeTargetHost(input.Host),
			input.Method,
			normalizedTargetPath,
		)
	}

	return matchingRoutes[0], true, nil
}
