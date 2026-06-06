package egressproxy

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

const (
	SandboxEgressRequestIDHeaderName           = "x-mistle-sandbox-egress-id"
	DirectGatewayEgressAuthorizationHeaderName = "x-mistle-egress-token"
)

type RequestTarget struct {
	Authority string
	Host      string
	URL       *url.URL
}

type RequestTargetOverride struct {
	Scheme           string
	DefaultAuthority string
}

func ResolveRequestTarget(request *http.Request, targetOverride *RequestTargetOverride) (RequestTarget, error) {
	if request == nil {
		return RequestTarget{}, fmt.Errorf("proxied request is required")
	}
	if request.URL == nil {
		return RequestTarget{}, fmt.Errorf("proxied request URL is required")
	}

	authority, err := resolveRequestAuthority(request, targetOverride)
	if err != nil {
		return RequestTarget{}, err
	}

	scheme := request.URL.Scheme
	if targetOverride != nil {
		scheme = targetOverride.Scheme
	}
	if scheme == "" {
		scheme = "http"
	}

	targetURL := cloneURL(request.URL)
	if request.URL.Scheme == "" || request.URL.Host == "" {
		targetURL, err = buildDirectForwardURL(scheme, authority, requestPathAndQuery(request))
		if err != nil {
			return RequestTarget{}, err
		}
	}

	return RequestTarget{
		Authority: authority,
		Host:      normalizeAuthorityHost(authority),
		URL:       targetURL,
	}, nil
}

func FilterDirectGatewayRequestHeaders(headers http.Header) http.Header {
	filteredHeaders := filterOutboundRequestHeaders(headers)
	filteredHeaders.Del(DirectGatewayEgressAuthorizationHeaderName)
	return filteredHeaders
}

func filterOutboundRequestHeaders(headers http.Header) http.Header {
	filteredHeaders := make(http.Header)
	for name, values := range headers {
		if isBlockedOutboundRequestHeader(name) {
			continue
		}
		for _, value := range values {
			filteredHeaders.Add(name, value)
		}
	}
	return filteredHeaders
}

func resolveRequestAuthority(request *http.Request, targetOverride *RequestTargetOverride) (string, error) {
	if request.URL.Host != "" {
		return request.URL.Host, nil
	}
	if request.Host != "" {
		return request.Host, nil
	}
	if host := request.Header.Get("Host"); host != "" {
		return host, nil
	}
	if targetOverride != nil {
		return targetOverride.DefaultAuthority, nil
	}
	return "", fmt.Errorf("proxied request is missing a host")
}

func buildDirectForwardURL(scheme string, authority string, pathAndQuery string) (*url.URL, error) {
	if pathAndQuery == "" {
		pathAndQuery = "/"
	}
	rawURL := fmt.Sprintf("%s://%s%s", scheme, authority, pathAndQuery)
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("failed to build direct forward uri for %q: %w", rawURL, err)
	}
	if parsedURL.Scheme == "" || parsedURL.Host == "" {
		return nil, fmt.Errorf("failed to build direct forward uri for %q: URI is missing scheme or authority", rawURL)
	}
	return parsedURL, nil
}

func requestPathAndQuery(request *http.Request) string {
	path := request.URL.EscapedPath()
	if path == "" {
		path = "/"
	}
	if request.URL.RawQuery == "" {
		return path
	}
	return path + "?" + request.URL.RawQuery
}

func isBlockedOutboundRequestHeader(name string) bool {
	switch strings.ToLower(name) {
	case "connection",
		"proxy-connection",
		"proxy-authenticate",
		"proxy-authorization",
		"keep-alive",
		"te",
		"trailer",
		"transfer-encoding",
		"upgrade",
		"host":
		return true
	default:
		return false
	}
}
