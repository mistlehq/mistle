package egressproxy

import (
	"fmt"
	"net/url"
	"strings"
)

type Route struct {
	EgressRuleID string
	Hosts        []string
	PathPrefixes []string
	Methods      []string
}

type CompiledEgressRoute struct {
	EgressRuleID string
	Match        CompiledEgressRouteMatch
	Upstream     CompiledEgressRouteUpstream
}

type CompiledEgressRouteMatch struct {
	Hosts        []string
	PathPrefixes []string
	Methods      []string
}

type CompiledEgressRouteUpstream struct {
	BaseURL string
}

func BuildGatewayEgressRoute(route CompiledEgressRoute) (Route, error) {
	upstreamURL, err := url.Parse(route.Upstream.BaseURL)
	if err != nil {
		return Route{}, fmt.Errorf("runtime plan egress route %q has invalid upstream base url %q: %w", route.EgressRuleID, route.Upstream.BaseURL, err)
	}
	if upstreamURL.Hostname() == "" {
		return Route{}, fmt.Errorf("runtime plan egress route %q upstream %q must include a host", route.EgressRuleID, route.Upstream.BaseURL)
	}
	if len(route.Match.Hosts) == 0 {
		return Route{}, fmt.Errorf("runtime plan egress route %q must include at least one match host", route.EgressRuleID)
	}

	pathPrefixes := route.Match.PathPrefixes
	if len(pathPrefixes) == 0 {
		pathPrefixes = []string{"/"}
	}
	methods := make([]string, 0, len(route.Match.Methods))
	for _, method := range route.Match.Methods {
		methods = append(methods, strings.ToUpper(method))
	}
	hosts := make([]string, 0, len(route.Match.Hosts))
	for _, host := range route.Match.Hosts {
		hosts = append(hosts, normalizeMatchHost(host))
	}
	return Route{
		EgressRuleID: route.EgressRuleID,
		Hosts:        hosts,
		PathPrefixes: append([]string(nil), pathPrefixes...),
		Methods:      methods,
	}, nil
}

func BuildDirectForwardURI(scheme string, authority string, pathAndQuery string) (string, error) {
	if pathAndQuery == "" {
		pathAndQuery = "/"
	}
	rawURL := fmt.Sprintf("%s://%s%s", scheme, authority, pathAndQuery)
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("failed to build direct forward uri for %q: %w", rawURL, err)
	}
	if parsedURL.Scheme == "" || parsedURL.Host == "" {
		return "", fmt.Errorf("failed to build direct forward uri for %q: URI is missing scheme or authority", rawURL)
	}
	return parsedURL.String(), nil
}

func MatchRoute(routes []Route, host string, path string, method string) (*Route, error) {
	normalizedHost := normalizeAuthorityHost(host)
	var matched *Route
	for index := range routes {
		route := &routes[index]
		if !routeMatches(route, normalizedHost, path, method) {
			continue
		}
		if matched != nil {
			return nil, fmt.Errorf("multiple sandbox egress routes matched proxied request %s %s%s", method, host, path)
		}
		matched = route
	}
	return matched, nil
}

func routeMatches(route *Route, normalizedHost string, path string, method string) bool {
	if !contains(route.Hosts, normalizedHost) {
		return false
	}
	if !pathMatchesAnyPrefix(path, route.PathPrefixes) {
		return false
	}
	return len(route.Methods) == 0 || contains(route.Methods, method)
}

func pathMatchesAnyPrefix(path string, pathPrefixes []string) bool {
	for _, pathPrefix := range pathPrefixes {
		if pathBelongsToPrefix(path, pathPrefix) {
			return true
		}
	}
	return false
}

func pathBelongsToPrefix(path string, pathPrefix string) bool {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if beforeQuery, _, ok := strings.Cut(path, "?"); ok {
		path = beforeQuery
	}
	normalizedPrefix := normalizePathPrefix(pathPrefix)
	return normalizedPrefix == "/" || path == normalizedPrefix || strings.HasPrefix(path, normalizedPrefix+"/")
}

func normalizePathPrefix(pathPrefix string) string {
	trimmed := strings.TrimSpace(pathPrefix)
	if trimmed == "/" {
		return "/"
	}
	return strings.TrimSuffix(trimmed, "/")
}

func normalizeAuthorityHost(authority string) string {
	normalized := strings.ToLower(strings.TrimSpace(authority))
	if withoutBracket, ok := strings.CutPrefix(normalized, "["); ok {
		host, _, found := strings.Cut(withoutBracket, "]")
		if found {
			return host
		}
	}
	host, _, found := strings.Cut(normalized, ":")
	if found {
		return host
	}
	return normalized
}

func normalizeMatchHost(host string) string {
	normalized := strings.ToLower(strings.TrimSpace(host))
	if withoutBracket, ok := strings.CutPrefix(normalized, "["); ok {
		host, _, found := strings.Cut(withoutBracket, "]")
		if found {
			return host
		}
	}
	return normalized
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
