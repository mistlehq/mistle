package egress

import (
	"testing"
)

func TestBuildProxyMediationBaseAttributes(t *testing.T) {
	attributes := buildProxyMediationBaseAttributes("api.github.com", "POST", "/graphql")
	if len(attributes) != 3 {
		t.Fatalf("expected 3 attributes, got %d", len(attributes))
	}

	if attributes[0].Key != "server.address" || attributes[0].Value.AsString() != "api.github.com" {
		t.Fatalf("unexpected server.address attribute: %s=%s", attributes[0].Key, attributes[0].Value.AsString())
	}
	if attributes[1].Key != "http.request.method" || attributes[1].Value.AsString() != "POST" {
		t.Fatalf("unexpected http.request.method attribute: %s=%s", attributes[1].Key, attributes[1].Value.AsString())
	}
	if attributes[2].Key != "url.path" || attributes[2].Value.AsString() != "/graphql" {
		t.Fatalf("unexpected url.path attribute: %s=%s", attributes[2].Key, attributes[2].Value.AsString())
	}
}
