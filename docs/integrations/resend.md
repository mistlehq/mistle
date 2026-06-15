# Resend Integration

The Resend integration exposes the official Resend MCP server to sandbox agents without placing the Resend API key in the sandbox as a real credential.

## Connection Setup

Create a Resend API key and add it to Mistle with the **API key** connection method.

For send-only workflows, prefer a Resend `sending_access` key. Use a `full_access` key only when the agent should manage broader Resend account resources such as contacts, broadcasts, domains, webhooks, API keys, topics, segments, contact properties, and received emails.

## Binding Setup

Select **Resend MCP** to install the pinned official `resend-mcp` runtime artifact and expose it to the selected agent runtime.

- **Default sender email** is optional and maps to the MCP server's default sender setting. It must be an email address from a verified Resend domain.
- **Default reply-to emails** are optional reply-to addresses injected into the MCP server.

If no default sender email is configured, the MCP server asks for a sender when a tool call needs one.

## Resend MCP Runtime

Resend MCP is installed from the official `resend-mcp` npm package as a pinned runtime artifact, then launched through Mistle's wrapper command. The wrapper provides a placeholder `RESEND_API_KEY` so the MCP server can construct requests, while managed egress applies the real Resend API key from the integration connection to outbound `api.resend.com` requests.

Resend does not currently provide a verified provider-hosted OAuth MCP endpoint. If Resend adds provider-hosted OAuth MCP support later, prefer that hosted option over the local runtime artifact.
