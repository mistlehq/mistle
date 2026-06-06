package egressproxy

import "testing"

func TestMatchesRouteByHostPathAndMethod(t *testing.T) {
	routes := []Route{
		{EgressRuleID: "egress-rule-a", Hosts: []string{"api.github.com"}, PathPrefixes: []string{"/graphql"}, Methods: []string{"POST"}},
		{EgressRuleID: "egress-rule-b", Hosts: []string{"github.com"}, PathPrefixes: []string{"/mistlehq/mistle.git"}, Methods: []string{"GET"}},
	}

	graphqlRoute, err := MatchRoute(routes, "api.github.com", "/graphql", "POST")
	requireNoError(t, err)
	assertEqual(t, graphqlRoute.EgressRuleID, "egress-rule-a")

	gitRoute, err := MatchRoute(routes, "github.com", "/mistlehq/mistle.git/info/refs", "GET")
	requireNoError(t, err)
	assertEqual(t, gitRoute.EgressRuleID, "egress-rule-b")
}

func TestLeavesUnmatchedRequestsForDirectPassthrough(t *testing.T) {
	routes := []Route{{EgressRuleID: "egress-rule-a", Hosts: []string{"api.openai.com"}, PathPrefixes: []string{"/v1/responses"}, Methods: []string{"POST"}}}

	route, err := MatchRoute(routes, "deb.debian.org", "/debian/dists/bookworm/InRelease", "GET")
	requireNoError(t, err)

	if route != nil {
		t.Fatalf("expected no route, got %#v", route)
	}
}

func TestDoesNotMatchSiblingPathsThatOnlyShareStringPrefix(t *testing.T) {
	routes := []Route{{EgressRuleID: "egress-rule-planetscale", Hosts: []string{"mcp.pscale.dev"}, PathPrefixes: []string{"/mcp/planetscale"}, Methods: []string{"POST"}}}

	route, err := MatchRoute(routes, "mcp.pscale.dev", "/mcp/planetscale-insights-only", "POST")
	requireNoError(t, err)

	if route != nil {
		t.Fatalf("expected sibling path not to match, got %#v", route)
	}
}

func TestMatchesChildPathsUnderDeclaredPrefix(t *testing.T) {
	routes := []Route{{EgressRuleID: "egress-rule-planetscale", Hosts: []string{"mcp.pscale.dev"}, PathPrefixes: []string{"/mcp/planetscale"}, Methods: []string{"POST"}}}

	route, err := MatchRoute(routes, "mcp.pscale.dev", "/mcp/planetscale/tools/list", "POST")
	requireNoError(t, err)
	assertEqual(t, route.EgressRuleID, "egress-rule-planetscale")
}

func TestMatchesExactPathPrefixWithQueryString(t *testing.T) {
	routes := []Route{{EgressRuleID: "egress-rule-planetscale", Hosts: []string{"mcp.pscale.dev"}, PathPrefixes: []string{"/mcp/planetscale"}, Methods: []string{"POST"}}}

	route, err := MatchRoute(routes, "mcp.pscale.dev", "/mcp/planetscale?cursor=1", "POST")
	requireNoError(t, err)
	assertEqual(t, route.EgressRuleID, "egress-rule-planetscale")
}

func TestBuildDirectForwardURI(t *testing.T) {
	directURI, err := BuildDirectForwardURI("https", "api.example.test", "/v1/responses?stream=true")
	requireNoError(t, err)

	assertEqual(t, directURI, "https://api.example.test/v1/responses?stream=true")
}

func TestBuildGatewayEgressRouteNormalizesMatchFields(t *testing.T) {
	route, err := BuildGatewayEgressRoute(CompiledEgressRoute{
		EgressRuleID: "egress-rule-a",
		Match: CompiledEgressRouteMatch{
			Hosts:        []string{"API.EXAMPLE.TEST:443"},
			PathPrefixes: nil,
			Methods:      []string{"post"},
		},
		Upstream: CompiledEgressRouteUpstream{BaseURL: "https://gateway.example.test/direct"},
	})
	requireNoError(t, err)

	assertEqual(t, route.Hosts[0], "api.example.test:443")
	assertEqual(t, route.PathPrefixes[0], "/")
	assertEqual(t, route.Methods[0], "POST")
}

func TestManagedProxyEnvIncludesCAVariablesWithoutProxyRouting(t *testing.T) {
	env := BuildManagedProxyEnv("/run/mistle/sandboxd/egress-proxy-ca-bundle.pem")

	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"} {
		if _, ok := env[key]; ok {
			t.Fatalf("expected proxy env %s to be absent", key)
		}
	}
	assertEqual(t, env[SSL_CERT_FILE], "/run/mistle/sandboxd/egress-proxy-ca-bundle.pem")
	assertEqual(t, env[NIX_SSL_CERT_FILE], "/run/mistle/sandboxd/egress-proxy-ca-bundle.pem")
	if contains(ManagedProxyEnvKeys, "HTTPS_PROXY") {
		t.Fatalf("expected managed proxy keys not to contain HTTPS_PROXY")
	}
	if !contains(ManagedProxyEnvKeys, NODE_EXTRA_CA_CERTS) {
		t.Fatalf("expected managed proxy keys to contain NODE_EXTRA_CA_CERTS")
	}
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
