package tunnel

import (
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

func TestResolveAgentEndpoint(t *testing.T) {
	t.Run("returns nil endpoint when runtime plan declares zero agent runtimes", func(t *testing.T) {
		endpoint, err := resolveAgentEndpoint([]startup.AgentRuntime{}, []startup.RuntimeClient{})
		if err != nil {
			t.Fatalf("expected endpoint resolution to succeed for zero agent runtimes, got %v", err)
		}
		if endpoint != nil {
			t.Fatal("expected nil endpoint when no agent runtime is declared")
		}
	})

	t.Run("fails when runtime plan declares multiple agent runtimes", func(t *testing.T) {
		_, err := resolveAgentEndpoint([]startup.AgentRuntime{
			{
				BindingID:   "bind_one",
				RuntimeKey:  "runtime_one",
				ClientID:    "client_one",
				EndpointKey: "endpoint_one",
			},
			{
				BindingID:   "bind_two",
				RuntimeKey:  "runtime_two",
				ClientID:    "client_two",
				EndpointKey: "endpoint_two",
			},
		}, []startup.RuntimeClient{
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
			t.Fatal("expected endpoint resolution to fail when multiple agent runtimes are declared")
		}
	})

	t.Run("resolves declared agent runtime endpoint", func(t *testing.T) {
		endpoint, err := resolveAgentEndpoint([]startup.AgentRuntime{
			{
				BindingID:   "bind_openai",
				RuntimeKey:  "codex-app-server",
				ClientID:    "client_codex",
				EndpointKey: "app-server",
			},
		}, []startup.RuntimeClient{
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

	t.Run("fails when declared agent endpoint is not websocket", func(t *testing.T) {
		endpoint, err := resolveAgentEndpoint([]startup.AgentRuntime{
			{
				BindingID:   "bind_openai",
				RuntimeKey:  "codex-app-server",
				ClientID:    "client_codex",
				EndpointKey: "http-endpoint",
			},
		}, []startup.RuntimeClient{
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
		if err == nil {
			t.Fatal("expected endpoint resolution to fail for non-websocket agent endpoint")
		}
		if endpoint != nil {
			t.Fatal("expected no resolved endpoint when agent runtime points at a non-websocket endpoint")
		}
	})
}
