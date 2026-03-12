package egress

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

const (
	HeaderEgressRouteID               = "X-Mistle-Egress-Route-Id"
	HeaderEgressBindingID             = "X-Mistle-Egress-Binding-Id"
	HeaderEgressUpstreamBaseURL       = "X-Mistle-Egress-Upstream-Base-Url"
	HeaderEgressAuthInjectionType     = "X-Mistle-Egress-Auth-Injection-Type"
	HeaderEgressAuthInjectionTarget   = "X-Mistle-Egress-Auth-Injection-Target"
	HeaderEgressAuthInjectionUsername = "X-Mistle-Egress-Auth-Injection-Username"
	HeaderEgressConnectionID          = "X-Mistle-Egress-Connection-Id"
	HeaderEgressCredentialSecretType  = "X-Mistle-Egress-Credential-Secret-Type"
	HeaderEgressCredentialPurpose     = "X-Mistle-Egress-Credential-Purpose"
	HeaderEgressCredentialResolverKey = "X-Mistle-Egress-Credential-Resolver-Key"
	HeaderSandboxProfileID            = "X-Mistle-Sandbox-Profile-Id"
	HeaderSandboxProfileVersion       = "X-Mistle-Sandbox-Profile-Version"
)

type Forwarder struct {
	httpClient            *http.Client
	tokenizerProxyBaseURL *url.URL
	runtimePlan           startup.RuntimePlan
}

type NewForwarderInput struct {
	HTTPClient                  *http.Client
	TokenizerProxyEgressBaseURL string
	RuntimePlan                 startup.RuntimePlan
}

func NewForwarder(input NewForwarderInput) (Forwarder, error) {
	if input.HTTPClient == nil {
		return Forwarder{}, fmt.Errorf("http client is required")
	}

	tokenizerProxyBaseURL, err := url.Parse(strings.TrimSpace(input.TokenizerProxyEgressBaseURL))
	if err != nil {
		return Forwarder{}, fmt.Errorf("failed to parse tokenizer proxy egress base url: %w", err)
	}
	if tokenizerProxyBaseURL.Scheme != "http" && tokenizerProxyBaseURL.Scheme != "https" {
		return Forwarder{}, fmt.Errorf("tokenizer proxy egress base url must use http or https scheme")
	}
	if tokenizerProxyBaseURL.Host == "" {
		return Forwarder{}, fmt.Errorf("tokenizer proxy egress base url host is required")
	}

	return Forwarder{
		httpClient:            input.HTTPClient,
		tokenizerProxyBaseURL: tokenizerProxyBaseURL,
		runtimePlan:           input.RuntimePlan,
	}, nil
}

func joinPath(basePath string, suffixPath string) string {
	normalizedBasePath := strings.TrimSuffix(basePath, "/")
	normalizedSuffixPath := strings.TrimPrefix(suffixPath, "/")

	if normalizedBasePath == "" {
		normalizedBasePath = "/"
	}

	if normalizedSuffixPath == "" {
		return normalizedBasePath
	}

	if normalizedBasePath == "/" {
		return "/" + normalizedSuffixPath
	}

	return normalizedBasePath + "/" + normalizedSuffixPath
}

func createTokenizerProxyURL(input struct {
	baseURL    *url.URL
	targetPath string
	rawQuery   string
}) string {
	forwardURL := *input.baseURL
	forwardURL.Path = joinPath(forwardURL.Path, input.targetPath)
	forwardURL.RawQuery = input.rawQuery
	forwardURL.Fragment = ""
	return forwardURL.String()
}

func copyHeadersWithoutHopByHop(target http.Header, source http.Header) {
	for headerName, values := range source {
		normalizedHeaderName := strings.ToLower(headerName)
		switch normalizedHeaderName {
		case "connection", "proxy-connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host":
			continue
		}

		for _, value := range values {
			target.Add(headerName, value)
		}
	}
}

func (forwarder Forwarder) buildForwardRequest(input struct {
	incomingRequest *http.Request
	route           startup.EgressCredentialRoute
	targetPath      string
}) (*http.Request, error) {
	forwardRequestURL := createTokenizerProxyURL(struct {
		baseURL    *url.URL
		targetPath string
		rawQuery   string
	}{
		baseURL:    forwarder.tokenizerProxyBaseURL,
		targetPath: input.targetPath,
		rawQuery:   input.incomingRequest.URL.RawQuery,
	})

	forwardRequest, err := http.NewRequestWithContext(
		input.incomingRequest.Context(),
		input.incomingRequest.Method,
		forwardRequestURL,
		input.incomingRequest.Body,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create tokenizer proxy request: %w", err)
	}

	copyHeadersWithoutHopByHop(forwardRequest.Header, input.incomingRequest.Header)
	forwardRequest.Header.Set(HeaderEgressRouteID, input.route.RouteID)
	forwardRequest.Header.Set(HeaderEgressBindingID, input.route.BindingID)
	forwardRequest.Header.Set(HeaderEgressUpstreamBaseURL, input.route.Upstream.BaseURL)
	forwardRequest.Header.Set(HeaderEgressAuthInjectionType, input.route.AuthInjection.Type)
	forwardRequest.Header.Set(HeaderEgressAuthInjectionTarget, input.route.AuthInjection.Target)
	if strings.TrimSpace(input.route.AuthInjection.Username) != "" {
		forwardRequest.Header.Set(
			HeaderEgressAuthInjectionUsername,
			input.route.AuthInjection.Username,
		)
	}
	forwardRequest.Header.Set(HeaderEgressConnectionID, input.route.CredentialResolver.ConnectionID)
	forwardRequest.Header.Set(HeaderEgressCredentialSecretType, input.route.CredentialResolver.SecretType)
	if strings.TrimSpace(input.route.CredentialResolver.Purpose) != "" {
		forwardRequest.Header.Set(
			HeaderEgressCredentialPurpose,
			input.route.CredentialResolver.Purpose,
		)
	}
	if strings.TrimSpace(input.route.CredentialResolver.ResolverKey) != "" {
		forwardRequest.Header.Set(
			HeaderEgressCredentialResolverKey,
			input.route.CredentialResolver.ResolverKey,
		)
	}
	forwardRequest.Header.Set(HeaderSandboxProfileID, forwarder.runtimePlan.SandboxProfileID)
	forwardRequest.Header.Set(
		HeaderSandboxProfileVersion,
		fmt.Sprintf("%d", forwarder.runtimePlan.Version),
	)

	return forwardRequest, nil
}

func (forwarder Forwarder) Forward(input struct {
	incomingRequest *http.Request
	route           startup.EgressCredentialRoute
	targetPath      string
}) (*http.Response, error) {
	forwardRequest, err := forwarder.buildForwardRequest(struct {
		incomingRequest *http.Request
		route           startup.EgressCredentialRoute
		targetPath      string
	}{
		incomingRequest: input.incomingRequest,
		route:           input.route,
		targetPath:      input.targetPath,
	})
	if err != nil {
		return nil, err
	}

	response, err := forwarder.httpClient.Do(forwardRequest)
	if err != nil {
		return nil, fmt.Errorf("failed to forward request to tokenizer proxy: %w", err)
	}

	return response, nil
}
