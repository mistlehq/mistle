package egress

import (
	"fmt"
	"net/http"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/proxy"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type ProxyMediator struct {
	resolver  Resolver
	forwarder Forwarder
}

type NewProxyMediatorInput struct {
	RuntimePlan                 startup.RuntimePlan
	TokenizerProxyEgressBaseURL string
	HTTPClient                  *http.Client
}

func NewProxyMediator(input NewProxyMediatorInput) (ProxyMediator, error) {
	forwarder, err := NewForwarder(NewForwarderInput{
		HTTPClient:                  input.HTTPClient,
		TokenizerProxyEgressBaseURL: input.TokenizerProxyEgressBaseURL,
		RuntimePlan:                 input.RuntimePlan,
	})
	if err != nil {
		return ProxyMediator{}, err
	}

	return ProxyMediator{
		resolver:  NewResolver(NewResolverInput{RuntimePlan: input.RuntimePlan}),
		forwarder: forwarder,
	}, nil
}

func (mediator ProxyMediator) ForwardIfMatch(
	request *http.Request,
	classification proxy.RequestClassification,
) (*http.Response, bool, error) {
	route, matched, err := mediator.resolver.ResolveMatchingRoute(ResolveMatchingRouteInput{
		Host:       classification.Host,
		Method:     classification.Method,
		TargetPath: classification.Path,
	})
	if err != nil {
		return nil, false, fmt.Errorf("failed to resolve matching egress route: %w", err)
	}
	if !matched {
		return nil, false, nil
	}

	response, err := mediator.forwarder.Forward(struct {
		incomingRequest *http.Request
		route           startup.EgressCredentialRoute
		targetPath      string
	}{
		incomingRequest: request,
		route:           route,
		targetPath:      classification.Path,
	})
	if err != nil {
		return nil, true, err
	}

	return response, true, nil
}
