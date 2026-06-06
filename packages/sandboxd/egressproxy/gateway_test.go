package egressproxy

import "testing"

func TestResolvesDirectGatewayRouteURLsFromBootstrapTunnelURL(t *testing.T) {
	httpRoute, err := ResolveDirectGatewayRouteURL(
		"wss://gateway.example.test/tunnel/sandbox/sbi_123?x-mistle-test-environment-id=test_env_123",
		DirectEgressHTTPRoutePath,
		DirectGatewayRouteSchemeHTTP,
	)
	requireNoError(t, err)
	webSocketRoute, err := ResolveDirectGatewayRouteURL(
		"wss://gateway.example.test/tunnel/sandbox/sbi_123?x-mistle-test-environment-id=test_env_123",
		DirectEgressWebSocketRoutePath,
		DirectGatewayRouteSchemeWebSocket,
	)
	requireNoError(t, err)

	assertEqual(t, httpRoute.String(), "https://gateway.example.test/_mistle/egress/http?x-mistle-test-environment-id=test_env_123")
	assertEqual(t, webSocketRoute.String(), "wss://gateway.example.test/_mistle/egress/ws?x-mistle-test-environment-id=test_env_123")
}

func TestConvertsHTTPTargetsToWebSocketTargetsForDirectGatewayEgress(t *testing.T) {
	httpsTarget, err := WebSocketTargetURL("https://chatgpt.com/backend-api/codex?model=gpt")
	requireNoError(t, err)
	httpTarget, err := WebSocketTargetURL("http://127.0.0.1:3000/socket")
	requireNoError(t, err)

	assertEqual(t, httpsTarget, "wss://chatgpt.com/backend-api/codex?model=gpt")
	assertEqual(t, httpTarget, "ws://127.0.0.1:3000/socket")
}

func TestLeavesWebSocketTargetsUnchangedForDirectGatewayEgress(t *testing.T) {
	target, err := WebSocketTargetURL("wss://gateway.example.test/socket?token=abc")
	requireNoError(t, err)

	assertEqual(t, target, "wss://gateway.example.test/socket?token=abc")
}

func TestRejectsUnsupportedTunnelGatewayScheme(t *testing.T) {
	_, err := ResolveDirectGatewayRouteURL(
		"https://gateway.example.test/tunnel/sandbox/sbi_123",
		DirectEgressHTTPRoutePath,
		DirectGatewayRouteSchemeHTTP,
	)
	if err == nil {
		t.Fatalf("expected unsupported tunnel gateway scheme to fail")
	}
	assertEqual(t, err.Error(), "sandbox tunnel gateway ws url must use ws or wss scheme, got \"https\"")
}

func TestRejectsUnsupportedWebSocketTargetScheme(t *testing.T) {
	_, err := WebSocketTargetURL("ftp://example.test/socket")
	if err == nil {
		t.Fatalf("expected unsupported websocket target scheme to fail")
	}
	assertEqual(t, err.Error(), "websocket egress target must use http, https, ws, or wss scheme, got \"ftp\"")
}

func TestBuildsDirectGatewayHTTPAndWebSocketURLs(t *testing.T) {
	client, err := NewDirectGatewayEgressClient("ws://127.0.0.1:4500/tunnel/sandbox/sandbox-123?x-mistle-test-environment-id=test_env_123")
	requireNoError(t, err)

	httpRoute, err := client.DirectHTTPURL("https://api.example.test/v1/responses?stream=true")
	requireNoError(t, err)
	webSocketRoute, err := client.DirectWebSocketURL("https://chatgpt.com/backend-api/codex")
	requireNoError(t, err)

	assertEqual(t, httpRoute, "http://127.0.0.1:4500/_mistle/egress/http?x-mistle-test-environment-id=test_env_123&target=https%3A%2F%2Fapi.example.test%2Fv1%2Fresponses%3Fstream%3Dtrue")
	assertEqual(t, webSocketRoute, "ws://127.0.0.1:4500/_mistle/egress/ws?x-mistle-test-environment-id=test_env_123&target=wss%3A%2F%2Fchatgpt.com%2Fbackend-api%2Fcodex")
}

func TestDirectGatewayClientRequiresRouteURLs(t *testing.T) {
	client := DirectGatewayEgressClient{}

	_, httpErr := client.DirectHTTPURL("https://api.example.test/v1/responses")
	if httpErr == nil {
		t.Fatalf("expected missing HTTP route URL to fail")
	}
	assertEqual(t, httpErr.Error(), "direct gateway egress HTTP route URL is required")

	_, webSocketErr := client.DirectWebSocketURL("https://chatgpt.com/backend-api/codex")
	if webSocketErr == nil {
		t.Fatalf("expected missing websocket route URL to fail")
	}
	assertEqual(t, webSocketErr.Error(), "direct gateway egress websocket route URL is required")
}
