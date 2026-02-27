package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewRouter(t *testing.T) {
	t.Run("returns health payload for health route", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/__healthz", nil)

		NewRouter().ServeHTTP(recorder, request)

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

		NewRouter().ServeHTTP(recorder, request)

		if recorder.Code != http.StatusNotFound {
			t.Fatalf("expected status 404, got %d", recorder.Code)
		}
	})
}
