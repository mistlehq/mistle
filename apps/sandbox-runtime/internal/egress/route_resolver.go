package egress

import (
	"fmt"
	"strings"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type RouteMatchErrorCode string

const (
	RouteMatchErrorCodeRouteNotFound   RouteMatchErrorCode = "route_not_found"
	RouteMatchErrorCodeMethodForbidden RouteMatchErrorCode = "method_forbidden"
	RouteMatchErrorCodePathForbidden   RouteMatchErrorCode = "path_forbidden"
)

type RouteMatchError struct {
	Code    RouteMatchErrorCode
	Message string
}

func (err RouteMatchError) Error() string {
	return err.Message
}

type Resolver struct {
	routesByID map[string]startup.EgressCredentialRoute
}

type NewResolverInput struct {
	RuntimePlan startup.RuntimePlan
}

func NewResolver(input NewResolverInput) Resolver {
	routesByID := make(map[string]startup.EgressCredentialRoute, len(input.RuntimePlan.EgressRoutes))
	for _, route := range input.RuntimePlan.EgressRoutes {
		routesByID[route.RouteID] = route
	}

	return Resolver{
		routesByID: routesByID,
	}
}

type ResolveRouteInput struct {
	RouteID    string
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

func (resolver Resolver) ResolveRoute(input ResolveRouteInput) (startup.EgressCredentialRoute, error) {
	route, ok := resolver.routesByID[input.RouteID]
	if !ok {
		return startup.EgressCredentialRoute{}, RouteMatchError{
			Code:    RouteMatchErrorCodeRouteNotFound,
			Message: fmt.Sprintf("egress route '%s' was not found", input.RouteID),
		}
	}

	if len(route.Match.Methods) > 0 && !containsStringIgnoreCase(route.Match.Methods, input.Method) {
		return startup.EgressCredentialRoute{}, RouteMatchError{
			Code: RouteMatchErrorCodeMethodForbidden,
			Message: fmt.Sprintf(
				"egress route '%s' does not allow method '%s'",
				input.RouteID,
				input.Method,
			),
		}
	}

	normalizedTargetPath := normalizeTargetPath(input.TargetPath)
	if len(route.Match.PathPrefixes) > 0 && !pathMatchesPrefixes(route.Match.PathPrefixes, normalizedTargetPath) {
		return startup.EgressCredentialRoute{}, RouteMatchError{
			Code: RouteMatchErrorCodePathForbidden,
			Message: fmt.Sprintf(
				"egress route '%s' does not allow path '%s'",
				input.RouteID,
				normalizedTargetPath,
			),
		}
	}

	return route, nil
}
