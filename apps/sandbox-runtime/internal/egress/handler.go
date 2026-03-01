package egress

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

const routesPrefix = "/egress/routes/"

type Handler struct {
	resolver  Resolver
	forwarder Forwarder
}

type NewHandlerInput struct {
	RuntimePlan                 startup.RuntimePlan
	TokenizerProxyEgressBaseURL string
	HTTPClient                  *http.Client
}

func NewHandler(input NewHandlerInput) (http.Handler, error) {
	forwarder, err := NewForwarder(NewForwarderInput{
		HTTPClient:                  input.HTTPClient,
		TokenizerProxyEgressBaseURL: input.TokenizerProxyEgressBaseURL,
		RuntimePlan:                 input.RuntimePlan,
	})
	if err != nil {
		return nil, err
	}

	return Handler{
		resolver:  NewResolver(NewResolverInput{RuntimePlan: input.RuntimePlan}),
		forwarder: forwarder,
	}, nil
}

type errorPayload struct {
	Error string `json:"error"`
}

func writeErrorJSON(writer http.ResponseWriter, statusCode int, message string) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(statusCode)
	_ = json.NewEncoder(writer).Encode(errorPayload{Error: message})
}

func extractRoutePath(requestPath string) (routeID string, targetPath string, ok bool) {
	if !strings.HasPrefix(requestPath, routesPrefix) {
		return "", "", false
	}

	remainder := strings.TrimPrefix(requestPath, routesPrefix)
	if remainder == "" {
		return "", "", false
	}

	routeID, rest, hasSlash := strings.Cut(remainder, "/")
	if routeID == "" {
		return "", "", false
	}
	if !hasSlash {
		return routeID, "/", true
	}

	return routeID, "/" + rest, true
}

func copyResponseHeaders(target http.Header, source http.Header) {
	for headerName, values := range source {
		for _, value := range values {
			target.Add(headerName, value)
		}
	}
}

func statusForRouteMatchError(errorCode RouteMatchErrorCode) int {
	switch errorCode {
	case RouteMatchErrorCodeRouteNotFound:
		return http.StatusNotFound
	case RouteMatchErrorCodeMethodForbidden:
		return http.StatusMethodNotAllowed
	case RouteMatchErrorCodePathForbidden:
		return http.StatusForbidden
	default:
		return http.StatusBadRequest
	}
}

func (handler Handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	routeID, targetPath, ok := extractRoutePath(request.URL.Path)
	if !ok {
		writeErrorJSON(writer, http.StatusNotFound, "egress route path was not found")
		return
	}

	route, err := handler.resolver.ResolveRoute(ResolveRouteInput{
		RouteID:    routeID,
		Method:     request.Method,
		TargetPath: targetPath,
	})
	if err != nil {
		var routeMatchError RouteMatchError
		if ok := errorsAsRouteMatchError(err, &routeMatchError); ok {
			writeErrorJSON(writer, statusForRouteMatchError(routeMatchError.Code), routeMatchError.Message)
			return
		}

		writeErrorJSON(writer, http.StatusBadRequest, err.Error())
		return
	}

	forwardResponse, err := handler.forwarder.Forward(struct {
		incomingRequest *http.Request
		route           startup.EgressCredentialRoute
		targetPath      string
	}{
		incomingRequest: request,
		route:           route,
		targetPath:      targetPath,
	})
	if err != nil {
		writeErrorJSON(writer, http.StatusBadGateway, fmt.Sprintf("failed to forward egress request: %v", err))
		return
	}
	defer forwardResponse.Body.Close()

	copyResponseHeaders(writer.Header(), forwardResponse.Header)
	writer.WriteHeader(forwardResponse.StatusCode)
	_, _ = io.Copy(writer, forwardResponse.Body)
}

func errorsAsRouteMatchError(err error, target *RouteMatchError) bool {
	if target == nil {
		return false
	}
	routeMatchError, ok := err.(RouteMatchError)
	if !ok {
		return false
	}
	*target = routeMatchError
	return true
}
