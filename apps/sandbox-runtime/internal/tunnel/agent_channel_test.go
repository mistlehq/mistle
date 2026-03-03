package tunnel

import (
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

func TestResolveAgentEndpoint(t *testing.T) {
	t.Run("returns nil endpoint when runtime plan declares zero websocket endpoints", func(t *testing.T) {
		endpoint, err := resolveAgentEndpoint([]startup.RuntimeClient{})
		if err != nil {
			t.Fatalf("expected endpoint resolution to succeed for zero websocket endpoints, got %v", err)
		}
		if endpoint != nil {
			t.Fatal("expected nil endpoint when no websocket endpoint is declared")
		}
	})

	t.Run("fails when runtime plan declares multiple websocket endpoints", func(t *testing.T) {
		_, err := resolveAgentEndpoint([]startup.RuntimeClient{
			{
				ClientID: "client_one",
				Endpoints: []startup.RuntimeClientEndpointSpec{
					{
						EndpointKey:    "endpoint_one",
						ConnectionMode: "dedicated",
						Transport: startup.RuntimeClientEndpointTransport{
							Type: "ws",
							URL:  "ws://127.0.0.1:4500",
						},
					},
				},
			},
			{
				ClientID: "client_two",
				Endpoints: []startup.RuntimeClientEndpointSpec{
					{
						EndpointKey:    "endpoint_two",
						ConnectionMode: "dedicated",
						Transport: startup.RuntimeClientEndpointTransport{
							Type: "ws",
							URL:  "ws://127.0.0.1:4600",
						},
					},
				},
			},
		})
		if err == nil {
			t.Fatal("expected endpoint resolution to fail when multiple websocket endpoints are declared")
		}
	})

	t.Run("resolves single websocket endpoint", func(t *testing.T) {
		endpoint, err := resolveAgentEndpoint([]startup.RuntimeClient{
			{
				ClientID: "client_codex",
				Endpoints: []startup.RuntimeClientEndpointSpec{
					{
						EndpointKey:    "app-server",
						ConnectionMode: "dedicated",
						Transport: startup.RuntimeClientEndpointTransport{
							Type: "ws",
							URL:  "ws://127.0.0.1:4500",
						},
					},
				},
			},
		})
		if err != nil {
			t.Fatalf("expected endpoint resolution to succeed, got %v", err)
		}
		if endpoint == nil {
			t.Fatal("expected endpoint to be resolved")
		}
		if endpoint.ClientID != "client_codex" {
			t.Fatalf("expected clientId 'client_codex', got '%s'", endpoint.ClientID)
		}
		if endpoint.EndpointKey != "app-server" {
			t.Fatalf("expected endpointKey 'app-server', got '%s'", endpoint.EndpointKey)
		}
		if endpoint.ConnectionMode != "dedicated" {
			t.Fatalf("expected connection mode 'dedicated', got '%s'", endpoint.ConnectionMode)
		}
		if endpoint.TransportURL != "ws://127.0.0.1:4500" {
			t.Fatalf("expected transport url 'ws://127.0.0.1:4500', got '%s'", endpoint.TransportURL)
		}
	})

	t.Run("ignores non-websocket endpoints", func(t *testing.T) {
		endpoint, err := resolveAgentEndpoint([]startup.RuntimeClient{
			{
				ClientID: "client_codex",
				Endpoints: []startup.RuntimeClientEndpointSpec{
					{
						EndpointKey:    "http-endpoint",
						ConnectionMode: "dedicated",
						Transport: startup.RuntimeClientEndpointTransport{
							Type: "http",
							URL:  "http://127.0.0.1:4500",
						},
					},
				},
			},
		})
		if err != nil {
			t.Fatalf("expected endpoint resolution to succeed for non-websocket endpoints, got %v", err)
		}
		if endpoint != nil {
			t.Fatal("expected no resolved endpoint when only non-websocket endpoints exist")
		}
	})
}
