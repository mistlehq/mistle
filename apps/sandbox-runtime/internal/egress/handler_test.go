package egress

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type capturedForwardRequest struct {
	Method  string
	Path    string
	Query   string
	Body    string
	Headers http.Header
}

func buildRuntimePlanForHandlerTests() startup.RuntimePlan {
	return startup.RuntimePlan{
		SandboxProfileID: "sbp_handler_test",
		Version:          3,
		Image: startup.ResolvedSandboxImage{
			Source:   "default-base",
			ImageRef: "mistle/sandbox-base:dev",
		},
		EgressRoutes: []startup.EgressCredentialRoute{
			{
				RouteID:   "route_openai",
				BindingID: "ibd_openai",
				Match: startup.EgressRouteMatch{
					Hosts:        []string{"api.openai.com"},
					PathPrefixes: []string{"/v1"},
					Methods:      []string{"POST"},
				},
				Upstream: startup.EgressRouteUpstream{BaseURL: "https://api.openai.com/v1"},
				AuthInjection: startup.EgressAuthInjection{
					Type:   "bearer",
					Target: "authorization",
				},
				CredentialResolver: startup.EgressCredentialResolver{
					ConnectionID: "icn_openai",
					SecretType:   "api_key",
				},
			},
		},
		Artifacts:           []startup.RuntimeArtifactSpec{},
		RuntimeClientSetups: []startup.RuntimeClientSetup{},
	}
}

func TestHandlerServeHTTP(t *testing.T) {
	t.Run("forwards request to tokenizer proxy with route metadata headers", func(t *testing.T) {
		captured := capturedForwardRequest{}
		tokenizerProxy := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			bodyBytes, readErr := io.ReadAll(request.Body)
			if readErr != nil {
				t.Fatalf("expected request body to be readable, got %v", readErr)
			}

			captured = capturedForwardRequest{
				Method:  request.Method,
				Path:    request.URL.Path,
				Query:   request.URL.RawQuery,
				Body:    string(bodyBytes),
				Headers: request.Header.Clone(),
			}

			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_, _ = writer.Write([]byte(`{"ok":true}`))
		}))
		defer tokenizerProxy.Close()

		handler, err := NewHandler(NewHandlerInput{
			RuntimePlan:                 buildRuntimePlanForHandlerTests(),
			TokenizerProxyEgressBaseURL: tokenizerProxy.URL + "/tokenizer-egress",
			HTTPClient:                  http.DefaultClient,
		})
		if err != nil {
			t.Fatalf("expected no error creating handler, got %v", err)
		}

		request := httptest.NewRequest(
			http.MethodPost,
			"/egress/routes/route_openai/v1/chat/completions?stream=true",
			strings.NewReader(`{"model":"gpt-5"}`),
		)
		request.Header.Set("Content-Type", "application/json")

		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusCreated {
			t.Fatalf("expected status 201, got %d", recorder.Code)
		}
		if recorder.Body.String() != `{"ok":true}` {
			t.Fatalf("expected response body from tokenizer proxy, got %s", recorder.Body.String())
		}

		if captured.Method != http.MethodPost {
			t.Fatalf("expected forwarded method POST, got %s", captured.Method)
		}
		if captured.Path != "/tokenizer-egress/routes/route_openai/v1/chat/completions" {
			t.Fatalf("unexpected forwarded path: %s", captured.Path)
		}
		if captured.Query != "stream=true" {
			t.Fatalf("expected forwarded query stream=true, got %s", captured.Query)
		}
		if captured.Body != `{"model":"gpt-5"}` {
			t.Fatalf("unexpected forwarded body: %s", captured.Body)
		}

		if captured.Headers.Get(HeaderEgressRouteID) != "route_openai" {
			t.Fatalf("expected %s header", HeaderEgressRouteID)
		}
		if captured.Headers.Get(HeaderEgressBindingID) != "ibd_openai" {
			t.Fatalf("expected %s header", HeaderEgressBindingID)
		}
		if captured.Headers.Get(HeaderEgressUpstreamBaseURL) != "https://api.openai.com/v1" {
			t.Fatalf("expected %s header", HeaderEgressUpstreamBaseURL)
		}
		if captured.Headers.Get(HeaderEgressAuthInjectionType) != "bearer" {
			t.Fatalf("expected %s header", HeaderEgressAuthInjectionType)
		}
		if captured.Headers.Get(HeaderEgressAuthInjectionTarget) != "authorization" {
			t.Fatalf("expected %s header", HeaderEgressAuthInjectionTarget)
		}
		if captured.Headers.Get(HeaderEgressConnectionID) != "icn_openai" {
			t.Fatalf("expected %s header", HeaderEgressConnectionID)
		}
		if captured.Headers.Get(HeaderEgressCredentialSecretType) != "api_key" {
			t.Fatalf("expected %s header", HeaderEgressCredentialSecretType)
		}
		if captured.Headers.Get(HeaderSandboxProfileID) != "sbp_handler_test" {
			t.Fatalf("expected %s header", HeaderSandboxProfileID)
		}
		if captured.Headers.Get(HeaderSandboxProfileVersion) != "3" {
			t.Fatalf("expected %s header", HeaderSandboxProfileVersion)
		}
	})

	t.Run("returns 404 when route id does not exist", func(t *testing.T) {
		handler, err := NewHandler(NewHandlerInput{
			RuntimePlan:                 buildRuntimePlanForHandlerTests(),
			TokenizerProxyEgressBaseURL: "http://127.0.0.1:9999/tokenizer-egress",
			HTTPClient:                  http.DefaultClient,
		})
		if err != nil {
			t.Fatalf("expected no error creating handler, got %v", err)
		}

		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/egress/routes/route_missing/v1/chat/completions", nil)
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusNotFound {
			t.Fatalf("expected status 404, got %d", recorder.Code)
		}
	})

	t.Run("returns 405 when method is not allowed", func(t *testing.T) {
		handler, err := NewHandler(NewHandlerInput{
			RuntimePlan:                 buildRuntimePlanForHandlerTests(),
			TokenizerProxyEgressBaseURL: "http://127.0.0.1:9999/tokenizer-egress",
			HTTPClient:                  http.DefaultClient,
		})
		if err != nil {
			t.Fatalf("expected no error creating handler, got %v", err)
		}

		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/egress/routes/route_openai/v1/chat/completions", nil)
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("expected status 405, got %d", recorder.Code)
		}
	})

	t.Run("returns 403 when path is not allowed", func(t *testing.T) {
		handler, err := NewHandler(NewHandlerInput{
			RuntimePlan:                 buildRuntimePlanForHandlerTests(),
			TokenizerProxyEgressBaseURL: "http://127.0.0.1:9999/tokenizer-egress",
			HTTPClient:                  http.DefaultClient,
		})
		if err != nil {
			t.Fatalf("expected no error creating handler, got %v", err)
		}

		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/egress/routes/route_openai/v2/chat/completions", nil)
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusForbidden {
			t.Fatalf("expected status 403, got %d", recorder.Code)
		}
	})

	t.Run("returns 502 when tokenizer proxy forwarding fails", func(t *testing.T) {
		handler, err := NewHandler(NewHandlerInput{
			RuntimePlan:                 buildRuntimePlanForHandlerTests(),
			TokenizerProxyEgressBaseURL: "http://127.0.0.1:1/tokenizer-egress",
			HTTPClient:                  http.DefaultClient,
		})
		if err != nil {
			t.Fatalf("expected no error creating handler, got %v", err)
		}

		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/egress/routes/route_openai/v1/chat/completions", nil)
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusBadGateway {
			t.Fatalf("expected status 502, got %d", recorder.Code)
		}
	})
}
