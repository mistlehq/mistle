package egress

import (
	"fmt"
	"net/http"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/proxy"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
	internaltelemetry "github.com/mistlehq/mistle/apps/sandbox-runtime/internal/telemetry"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
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
	tracer := otel.Tracer(internaltelemetry.ServiceName)
	forwardContext, forwardSpan := tracer.Start(request.Context(), "sandbox.egress.proxy_mediation")
	defer forwardSpan.End()
	forwardSpan.SetAttributes(
		buildProxyMediationBaseAttributes(
			classification.Host,
			classification.Method,
			classification.Path,
		)...,
	)

	route, matched, err := mediator.resolver.ResolveMatchingRoute(ResolveMatchingRouteInput{
		Host:       classification.Host,
		Method:     classification.Method,
		TargetPath: classification.Path,
	})
	if err != nil {
		forwardSpan.RecordError(err)
		forwardSpan.SetStatus(codes.Error, "route resolution failed")
		return nil, false, fmt.Errorf("failed to resolve matching egress route: %w", err)
	}
	if !matched {
		forwardSpan.SetAttributes(attribute.Bool("mistle.egress.matched", false))
		return nil, false, nil
	}
	forwardSpan.SetAttributes(
		attribute.Bool("mistle.egress.matched", true),
		attribute.String("mistle.egress.route_id", route.RouteID),
		attribute.String("mistle.egress.binding_id", route.BindingID),
	)

	response, err := mediator.forwarder.Forward(struct {
		incomingRequest *http.Request
		route           startup.EgressCredentialRoute
		targetPath      string
	}{
		incomingRequest: request.WithContext(forwardContext),
		route:           route,
		targetPath:      classification.Path,
	})
	if err != nil {
		forwardSpan.RecordError(err)
		forwardSpan.SetStatus(codes.Error, "tokenizer proxy forward failed")
		return nil, true, err
	}
	forwardSpan.SetAttributes(attribute.Int("http.response.status_code", response.StatusCode))

	return response, true, nil
}
