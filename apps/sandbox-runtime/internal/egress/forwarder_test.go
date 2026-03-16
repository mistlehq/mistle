package egress

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

func TestForwarderBuildForwardRequestUsesHeaderAddressedTokenizerPath(t *testing.T) {
	forwarder, err := NewForwarder(NewForwarderInput{
		HTTPClient:                  mustHTTPClient(t),
		TokenizerProxyEgressBaseURL: "http://tokenizer-proxy.internal/tokenizer-proxy/egress",
		RuntimePlan: startup.RuntimePlan{
			SandboxProfileID: "sbp_test",
			Version:          7,
		},
	})
	if err != nil {
		t.Fatalf("expected forwarder creation to succeed, got %v", err)
	}

	incomingRequest := httptest.NewRequest(
		"POST",
		"https://api.openai.com/v1/responses?stream=true",
		nil,
	)

	forwardRequest, err := forwarder.buildForwardRequest(struct {
		incomingRequest *http.Request
		route           startup.EgressCredentialRoute
		targetPath      string
	}{
		incomingRequest: incomingRequest,
		route: startup.EgressCredentialRoute{
			EgressRuleID: "egress_rule_openai",
			BindingID:    "ibd_openai",
			Upstream: startup.EgressRouteUpstream{
				BaseURL: "https://api.openai.com/v1",
			},
			AuthInjection: startup.EgressAuthInjection{
				Type:   "bearer",
				Target: "authorization",
			},
			CredentialResolver: startup.EgressCredentialResolver{
				ConnectionID: "icn_openai",
				SecretType:   "api_key",
				Purpose:      "api_key",
				ResolverKey:  "default",
			},
		},
		targetPath: "/v1/responses",
	})
	if err != nil {
		t.Fatalf("expected forward request creation to succeed, got %v", err)
	}

	if forwardRequest.URL.Path != "/tokenizer-proxy/egress/v1/responses" {
		t.Fatalf("unexpected tokenizer proxy path %s", forwardRequest.URL.Path)
	}
	if forwardRequest.URL.RawQuery != "stream=true" {
		t.Fatalf("expected tokenizer proxy query stream=true, got %s", forwardRequest.URL.RawQuery)
	}
	if forwardRequest.Header.Get(HeaderEgressRuleID) != "egress_rule_openai" {
		t.Fatalf("expected egress rule id header to be preserved")
	}
}

func mustHTTPClient(t *testing.T) *http.Client {
	t.Helper()
	return &http.Client{}
}
