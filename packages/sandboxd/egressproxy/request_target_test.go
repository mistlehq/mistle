package egressproxy

import (
	"net/http"
	"testing"
)

func TestResolvesExplicitProxyRequestTarget(t *testing.T) {
	request := newRequest(t, "GET", "https://api.openai.com/v1/models?limit=1")

	target, err := ResolveRequestTarget(request, nil)
	requireNoError(t, err)

	assertEqual(t, target.Authority, "api.openai.com")
	assertEqual(t, target.Host, "api.openai.com")
	assertEqual(t, target.URL.String(), "https://api.openai.com/v1/models?limit=1")
}

func TestResolvesTransparentPlaintextHTTPTargetFromHostHeader(t *testing.T) {
	request := newRequest(t, "GET", "/v1/models?limit=1")
	request.Host = "api.openai.com"

	target, err := ResolveRequestTarget(request, &RequestTargetOverride{
		Scheme:           "http",
		DefaultAuthority: "203.0.113.10:80",
	})
	requireNoError(t, err)

	assertEqual(t, target.Authority, "api.openai.com")
	assertEqual(t, target.Host, "api.openai.com")
	assertEqual(t, target.URL.String(), "http://api.openai.com/v1/models?limit=1")
}

func TestResolvesTransparentTLSTargetFromHostHeader(t *testing.T) {
	request := newRequest(t, "GET", "/backend-api/codex/models")
	request.Host = "chatgpt.com"

	target, err := ResolveRequestTarget(request, &RequestTargetOverride{
		Scheme:           "https",
		DefaultAuthority: "203.0.113.20:443",
	})
	requireNoError(t, err)

	assertEqual(t, target.Authority, "chatgpt.com")
	assertEqual(t, target.Host, "chatgpt.com")
	assertEqual(t, target.URL.String(), "https://chatgpt.com/backend-api/codex/models")
}

func TestResolvesTransparentTargetFromOriginalDestinationWhenHostHeaderIsAbsent(t *testing.T) {
	request := newRequest(t, "GET", "/v1/models?limit=1")

	target, err := ResolveRequestTarget(request, &RequestTargetOverride{
		Scheme:           "http",
		DefaultAuthority: "203.0.113.10:80",
	})
	requireNoError(t, err)

	assertEqual(t, target.Authority, "203.0.113.10:80")
	assertEqual(t, target.Host, "203.0.113.10")
	assertEqual(t, target.URL.String(), "http://203.0.113.10:80/v1/models?limit=1")
}

func TestResolveRequestTargetRequiresHostForNonTransparentRequest(t *testing.T) {
	request := newRequest(t, "GET", "/v1/models?limit=1")

	_, err := ResolveRequestTarget(request, nil)
	if err == nil {
		t.Fatalf("expected missing host to fail")
	}
	assertEqual(t, err.Error(), "proxied request is missing a host")
}

func TestDirectGatewayRequestHeadersPreserveUpstreamAuthorization(t *testing.T) {
	headers := http.Header{}
	headers.Add("authorization", "Bearer upstream-token")
	headers.Add(DirectGatewayEgressAuthorizationHeaderName, "Bearer gateway-token")
	headers.Add("accept", "application/json")
	headers.Add("connection", "keep-alive")
	headers.Add("host", "api.example.test")

	filteredHeaders := FilterDirectGatewayRequestHeaders(headers)

	assertEqual(t, filteredHeaders.Get("authorization"), "Bearer upstream-token")
	assertEqual(t, filteredHeaders.Get("accept"), "application/json")
	assertEqual(t, filteredHeaders.Get(DirectGatewayEgressAuthorizationHeaderName), "")
	assertEqual(t, filteredHeaders.Get("connection"), "")
	assertEqual(t, filteredHeaders.Get("host"), "")
}

func newRequest(t *testing.T, method string, rawURL string) *http.Request {
	t.Helper()
	request, err := http.NewRequest(method, rawURL, nil)
	if err != nil {
		t.Fatalf("expected request to build, got %v", err)
	}
	request.Host = ""
	return request
}
