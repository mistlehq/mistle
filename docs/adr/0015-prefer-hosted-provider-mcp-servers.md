# Prefer hosted provider MCP servers when provider-hosted OAuth is available

When a provider offers an official hosted remote **Provider MCP server** with OAuth-compatible authorization, Mistle should prefer connecting to that hosted server instead of installing and running a local MCP runtime artifact.

Hosted provider MCP servers keep Mistle out of provider runtime operation, avoid package installation lifecycle in sandbox setup, and let the provider own server updates, protocol compatibility, and OAuth behavior. They also keep the provider integration scoped to the provider-hosted capability rather than to whatever broader tool bundle a local package may contain.

Mistle should use a local MCP runtime artifact when no official hosted server exists, when the hosted server is incompatible with Mistle's credential and egress model, or when the integration intentionally targets self-hosted or private endpoint support that the hosted server cannot reach. That local-runtime choice should be explicit because it changes credential handling, runtime plan shape, install lifecycle, and operational support.

BugSnag applies this policy: SmartBear offers an official hosted BugSnag remote MCP server with OAuth-compatible authorization, so the first BugSnag MCP integration should connect to the hosted server instead of installing the local `@smartbear/mcp` package. The local package remains a possible future path for self-hosted or API-token-specific use cases, but that would be a separate decision.

Operational setup guidance should live with each provider integration's documentation. Keep this ADR focused on the delivery-mode decision; keep user-facing OAuth field descriptions, permission expectations, and troubleshooting copy near the relevant integration definition and operations docs.
