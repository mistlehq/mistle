package egressproxy

import (
	"fmt"
	"net/url"
)

const (
	DirectEgressHTTPRoutePath      = "/_mistle/egress/http"
	DirectEgressWebSocketRoutePath = "/_mistle/egress/ws"
)

type DirectGatewayRouteScheme string

const (
	DirectGatewayRouteSchemeHTTP      DirectGatewayRouteScheme = "http"
	DirectGatewayRouteSchemeWebSocket DirectGatewayRouteScheme = "websocket"
)

type DirectGatewayEgressClient struct {
	HTTPRouteURL      *url.URL
	WebSocketRouteURL *url.URL
}

func NewDirectGatewayEgressClient(tunnelGatewayWebSocketURL string) (DirectGatewayEgressClient, error) {
	httpRouteURL, err := ResolveDirectGatewayRouteURL(tunnelGatewayWebSocketURL, DirectEgressHTTPRoutePath, DirectGatewayRouteSchemeHTTP)
	if err != nil {
		return DirectGatewayEgressClient{}, err
	}
	webSocketRouteURL, err := ResolveDirectGatewayRouteURL(tunnelGatewayWebSocketURL, DirectEgressWebSocketRoutePath, DirectGatewayRouteSchemeWebSocket)
	if err != nil {
		return DirectGatewayEgressClient{}, err
	}
	return DirectGatewayEgressClient{
		HTTPRouteURL:      httpRouteURL,
		WebSocketRouteURL: webSocketRouteURL,
	}, nil
}

func (client DirectGatewayEgressClient) DirectHTTPURL(targetURL string) (string, error) {
	if client.HTTPRouteURL == nil {
		return "", fmt.Errorf("direct gateway egress HTTP route URL is required")
	}
	routeURL := cloneURL(client.HTTPRouteURL)
	appendQueryParam(routeURL, "target", targetURL)
	return routeURL.String(), nil
}

func (client DirectGatewayEgressClient) DirectWebSocketURL(targetURL string) (string, error) {
	if client.WebSocketRouteURL == nil {
		return "", fmt.Errorf("direct gateway egress websocket route URL is required")
	}
	webSocketTargetURL, err := WebSocketTargetURL(targetURL)
	if err != nil {
		return "", err
	}
	routeURL := cloneURL(client.WebSocketRouteURL)
	appendQueryParam(routeURL, "target", webSocketTargetURL)
	return routeURL.String(), nil
}

func ResolveDirectGatewayRouteURL(tunnelGatewayWebSocketURL string, routePath string, routeScheme DirectGatewayRouteScheme) (*url.URL, error) {
	routeURL, err := url.Parse(tunnelGatewayWebSocketURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse sandbox tunnel gateway ws url for direct egress: %w", err)
	}
	routeSchemeValue, err := directGatewayRouteURLScheme(routeURL.Scheme, routeScheme)
	if err != nil {
		return nil, err
	}
	routeURL.Scheme = routeSchemeValue
	routeURL.Path = routePath
	routeURL.RawPath = ""
	return routeURL, nil
}

func WebSocketTargetURL(targetURL string) (string, error) {
	parsedTargetURL, err := url.Parse(targetURL)
	if err != nil {
		return "", fmt.Errorf("failed to parse websocket egress target %q: %w", targetURL, err)
	}
	switch parsedTargetURL.Scheme {
	case "http":
		parsedTargetURL.Scheme = "ws"
	case "https":
		parsedTargetURL.Scheme = "wss"
	case "ws", "wss":
	default:
		return "", fmt.Errorf("websocket egress target must use http, https, ws, or wss scheme, got %q", parsedTargetURL.Scheme)
	}
	return parsedTargetURL.String(), nil
}

func directGatewayRouteURLScheme(tunnelGatewayScheme string, routeScheme DirectGatewayRouteScheme) (string, error) {
	switch {
	case tunnelGatewayScheme == "ws" && routeScheme == DirectGatewayRouteSchemeHTTP:
		return "http", nil
	case tunnelGatewayScheme == "wss" && routeScheme == DirectGatewayRouteSchemeHTTP:
		return "https", nil
	case tunnelGatewayScheme == "ws" && routeScheme == DirectGatewayRouteSchemeWebSocket:
		return "ws", nil
	case tunnelGatewayScheme == "wss" && routeScheme == DirectGatewayRouteSchemeWebSocket:
		return "wss", nil
	case tunnelGatewayScheme != "ws" && tunnelGatewayScheme != "wss":
		return "", fmt.Errorf("sandbox tunnel gateway ws url must use ws or wss scheme, got %q", tunnelGatewayScheme)
	default:
		return "", fmt.Errorf("unsupported direct gateway route scheme %q", routeScheme)
	}
}

func cloneURL(source *url.URL) *url.URL {
	copied := *source
	return &copied
}

func appendQueryParam(targetURL *url.URL, key string, value string) {
	encodedParam := url.QueryEscape(key) + "=" + url.QueryEscape(value)
	if targetURL.RawQuery == "" {
		targetURL.RawQuery = encodedParam
		return
	}
	targetURL.RawQuery += "&" + encodedParam
}
