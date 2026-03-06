package telemetry

import (
	"context"
	"net/http"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace/noop"
)

func mapLookupEnv(values map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}

func TestInitialize_DisabledWhenTracesEndpointMissing(t *testing.T) {
	t.Cleanup(func() {
		otel.SetTracerProvider(noop.NewTracerProvider())
	})

	handle, err := Initialize(InitializeInput{
		LookupEnv: mapLookupEnv(map[string]string{}),
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if handle.Enabled() {
		t.Fatalf("expected tracing to be disabled")
	}
}

func TestInitialize_FailsWhenSandboxInstanceIDMissing(t *testing.T) {
	t.Cleanup(func() {
		otel.SetTracerProvider(noop.NewTracerProvider())
	})

	_, err := Initialize(InitializeInput{
		LookupEnv: mapLookupEnv(map[string]string{
			TracesEndpointEnv: "http://127.0.0.1:4318/v1/traces",
		}),
	})
	if err == nil {
		t.Fatalf("expected error when sandbox instance id is missing")
	}
}

func TestInitialize_EnabledWithRequiredConfiguration(t *testing.T) {
	t.Cleanup(func() {
		otel.SetTracerProvider(noop.NewTracerProvider())
	})

	handle, err := Initialize(InitializeInput{
		LookupEnv: mapLookupEnv(map[string]string{
			TracesEndpointEnv:    "http://127.0.0.1:4318/v1/traces",
			SandboxInstanceIDEnv: "sbi_test_trace",
		}),
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !handle.Enabled() {
		t.Fatalf("expected tracing to be enabled")
	}

	if shutdownErr := handle.Shutdown(context.Background()); shutdownErr != nil {
		t.Fatalf("expected shutdown to succeed, got %v", shutdownErr)
	}
}

func TestNewHTTPClient_UsesOtelTransportAndKeepsTimeout(t *testing.T) {
	baseClient := &http.Client{Timeout: 123}

	otelClient := NewHTTPClient(baseClient)
	if otelClient == baseClient {
		t.Fatalf("expected cloned client, got original reference")
	}
	if otelClient.Timeout != baseClient.Timeout {
		t.Fatalf("expected timeout to be preserved")
	}
	if otelClient.Transport == nil {
		t.Fatalf("expected otel-instrumented transport")
	}
}
