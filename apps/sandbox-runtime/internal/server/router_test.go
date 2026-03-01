package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewRouter(t *testing.T) {
	t.Run("returns healthy payload when bootstrap token is loaded", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/__healthz", nil)

		NewRouter(RouterInput{BootstrapTokenLoaded: true}).ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", recorder.Code)
		}
		if got := recorder.Header().Get("Content-Type"); got != "application/json" {
			t.Fatalf("expected content-type application/json, got %s", got)
		}
		if recorder.Body.String() != `{"ok":true}` {
			t.Fatalf("expected body {\"ok\":true}, got %s", recorder.Body.String())
		}
	})

	t.Run("returns not found for unknown path", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/healthz", nil)

		NewRouter(RouterInput{BootstrapTokenLoaded: true}).ServeHTTP(recorder, request)

		if recorder.Code != http.StatusNotFound {
			t.Fatalf("expected status 404, got %d", recorder.Code)
		}
	})

	t.Run("returns unhealthy payload when bootstrap token is not loaded", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/__healthz", nil)

		NewRouter(RouterInput{BootstrapTokenLoaded: false}).ServeHTTP(recorder, request)

		if recorder.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected status 503, got %d", recorder.Code)
		}
		if got := recorder.Header().Get("Content-Type"); got != "application/json" {
			t.Fatalf("expected content-type application/json, got %s", got)
		}
		if recorder.Body.String() != `{"ok":false}` {
			t.Fatalf("expected body {\"ok\":false}, got %s", recorder.Body.String())
		}
	})

	t.Run("delegates egress route requests to egress handler", func(t *testing.T) {
		egressHandler := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if request.Method != http.MethodPost {
				t.Fatalf("expected forwarded request method POST, got %s", request.Method)
			}
			if request.URL.Path != "/egress/routes/route_openai/v1/chat/completions" {
				t.Fatalf("unexpected forwarded path: %s", request.URL.Path)
			}

			writer.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(writer, `{"ok":true}`)
		})

		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(
			http.MethodPost,
			"/egress/routes/route_openai/v1/chat/completions",
			nil,
		)

		NewRouter(RouterInput{
			BootstrapTokenLoaded: true,
			EgressHandler:        egressHandler,
		}).ServeHTTP(recorder, request)

		if recorder.Code != http.StatusCreated {
			t.Fatalf("expected status 201, got %d", recorder.Code)
		}
		if recorder.Body.String() != `{"ok":true}` {
			t.Fatalf("expected body {\"ok\":true}, got %s", recorder.Body.String())
		}
	})
}
