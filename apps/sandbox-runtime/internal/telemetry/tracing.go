package telemetry

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

const ServiceName = "@mistle/sandbox-runtime"
const TracesEndpointEnv = "SANDBOX_RUNTIME_TELEMETRY_TRACES_ENDPOINT"
const SandboxInstanceIDEnv = "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID"

type InitializeInput struct {
	LookupEnv func(string) (string, bool)
}

type Handle struct {
	enabled  bool
	tracer   trace.Tracer
	shutdown func(context.Context) error
}

func disabledHandle() Handle {
	return Handle{
		enabled: false,
		tracer:  otel.Tracer(ServiceName),
		shutdown: func(context.Context) error {
			return nil
		},
	}
}

func validateTracesEndpoint(endpoint string) error {
	parsedURL, err := url.Parse(endpoint)
	if err != nil {
		return fmt.Errorf("value must be a valid URL: %w", err)
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return fmt.Errorf("value must use http or https scheme")
	}
	if parsedURL.Host == "" {
		return fmt.Errorf("value host is required")
	}

	return nil
}

func Initialize(input InitializeInput) (Handle, error) {
	if input.LookupEnv == nil {
		return Handle{}, fmt.Errorf("lookup env function is required")
	}

	tracesEndpoint, exists := input.LookupEnv(TracesEndpointEnv)
	if !exists || strings.TrimSpace(tracesEndpoint) == "" {
		return disabledHandle(), nil
	}
	tracesEndpoint = strings.TrimSpace(tracesEndpoint)

	if err := validateTracesEndpoint(tracesEndpoint); err != nil {
		return Handle{}, fmt.Errorf("%s is invalid: %w", TracesEndpointEnv, err)
	}

	sandboxInstanceID, exists := input.LookupEnv(SandboxInstanceIDEnv)
	if !exists || strings.TrimSpace(sandboxInstanceID) == "" {
		return Handle{}, fmt.Errorf("%s is required when %s is set", SandboxInstanceIDEnv, TracesEndpointEnv)
	}
	sandboxInstanceID = strings.TrimSpace(sandboxInstanceID)

	traceExporter, err := otlptracehttp.New(
		context.Background(),
		otlptracehttp.WithEndpointURL(tracesEndpoint),
	)
	if err != nil {
		return Handle{}, fmt.Errorf("failed to create OTLP traces exporter: %w", err)
	}

	traceResource := resource.NewWithAttributes(
		"",
		attribute.String("service.name", ServiceName),
		attribute.String("service.instance.id", sandboxInstanceID),
		attribute.String("mistle.sandbox.instance_id", sandboxInstanceID),
	)
	traceProvider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExporter),
		sdktrace.WithResource(traceResource),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(1))),
	)
	otel.SetTracerProvider(traceProvider)
	otel.SetTextMapPropagator(
		propagation.NewCompositeTextMapPropagator(
			propagation.TraceContext{},
			propagation.Baggage{},
		),
	)

	return Handle{
		enabled:  true,
		tracer:   traceProvider.Tracer(ServiceName),
		shutdown: traceProvider.Shutdown,
	}, nil
}

func (handle Handle) Enabled() bool {
	return handle.enabled
}

func (handle Handle) Tracer() trace.Tracer {
	return handle.tracer
}

func (handle Handle) Shutdown(ctx context.Context) error {
	return handle.shutdown(ctx)
}

func NewHTTPClient(baseClient *http.Client) *http.Client {
	if baseClient == nil {
		baseClient = http.DefaultClient
	}

	clonedClient := *baseClient
	baseTransport := clonedClient.Transport
	if baseTransport == nil {
		baseTransport = http.DefaultTransport
	}
	clonedClient.Transport = otelhttp.NewTransport(baseTransport)

	return &clonedClient
}
