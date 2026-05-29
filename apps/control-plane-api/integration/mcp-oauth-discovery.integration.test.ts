/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const itWithoutTrustedForwardedHeaders = createIntegrationTest({
  services: ["control-plane-api"],
  __serviceOptions: {
    controlPlaneApi: {
      mcpTrustForwardedHeaders: false,
    },
  },
});

describe.concurrent("MCP OAuth discovery", () => {
  it("serves path-specific protected resource metadata for the configured MCP resource", async ({
    env,
  }) => {
    const response = await fetchMcpResourcePath(env.controlPlaneApi.http.fetch, {
      baseUrl: env.controlPlaneApi.hostBaseUrl,
      path: "/.well-known/oauth-protected-resource/mcp",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
      authorization_servers: [env.controlPlaneApi.hostBaseUrl],
      scopes_supported: [
        "sandboxProfile:read",
        "sandboxProfile:update",
        "sandboxSession:create",
        "sandboxSession:read",
        "sandboxSession:connect",
      ],
      bearer_methods_supported: ["header"],
    });
  });

  it("does not serve the root protected-resource metadata path for MCP", async ({ env }) => {
    const response = await fetchMcpResourcePath(env.controlPlaneApi.http.fetch, {
      baseUrl: env.controlPlaneApi.hostBaseUrl,
      path: "/.well-known/oauth-protected-resource",
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 for MCP metadata and traffic requested through a different public host", async ({
    env,
  }) => {
    const metadataResponse = await env.controlPlaneApi.http.fetch(
      "/.well-known/oauth-protected-resource/mcp",
      {
        headers: {
          forwarded: "proto=https;host=api.example.test",
        },
      },
    );
    const mcpResponse = await env.controlPlaneApi.http.fetch("/mcp", {
      headers: {
        forwarded: "proto=https;host=api.example.test",
      },
    });

    expect(metadataResponse.status).toBe(404);
    expect(mcpResponse.status).toBe(404);
  });

  it("honors forwarded headers when configured", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      "/.well-known/oauth-protected-resource/mcp",
      {
        headers: {
          forwarded: createForwardedHeaderForBaseUrl(env.controlPlaneApi.hostBaseUrl),
        },
      },
    );

    expect(response.status).toBe(200);
  });

  it("serves OAuth authorization server metadata at the well-known root", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      "/.well-known/oauth-authorization-server",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      issuer: env.controlPlaneApi.hostBaseUrl,
      authorization_endpoint: `${env.controlPlaneApi.hostBaseUrl}/oauth/authorize`,
      token_endpoint: `${env.controlPlaneApi.hostBaseUrl}/oauth/token`,
      registration_endpoint: `${env.controlPlaneApi.hostBaseUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [
        "organization:read",
        "sandboxProfile:read",
        "sandboxProfile:update",
        "sandboxSession:connect",
        "sandboxSession:create",
        "sandboxSession:read",
        "sandboxSession:resume",
      ],
    });
  });

  it("does not serve authorization server metadata under the OAuth route", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      "/oauth/.well-known/oauth-authorization-server",
    );

    expect(response.status).toBe(404);
  });

  it("challenges unauthenticated MCP requests with protected resource metadata", async ({
    env,
  }) => {
    const response = await fetchMcpResourcePath(env.controlPlaneApi.http.fetch, {
      baseUrl: env.controlPlaneApi.hostBaseUrl,
      path: "/mcp",
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${env.controlPlaneApi.hostBaseUrl}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("challenges malformed bearer tokens as invalid_token", async ({ env }) => {
    const response = await fetchMcpResourcePath(env.controlPlaneApi.http.fetch, {
      baseUrl: env.controlPlaneApi.hostBaseUrl,
      path: "/mcp",
      headers: {
        authorization: "Bearer not-a-valid-token",
      },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer error="invalid_token", resource_metadata="${env.controlPlaneApi.hostBaseUrl}/.well-known/oauth-protected-resource/mcp"`,
    );
  });
});

describe.concurrent("MCP OAuth discovery without trusted forwarded headers", () => {
  itWithoutTrustedForwardedHeaders(
    "ignores forwarded headers when trustForwardedHeaders is false",
    async ({ env }) => {
      const response = await env.controlPlaneApi.http.fetch(
        "/.well-known/oauth-protected-resource/mcp",
        {
          headers: {
            forwarded: "proto=https;host=unexpected.example.test",
          },
        },
      );

      expect(response.status).toBe(200);
    },
  );
});

async function fetchMcpResourcePath(
  fetch: (
    path: string,
    init?: { headers?: Record<string, string> },
  ) => Promise<{
    status: number;
    headers: { get(name: string): string | null };
    json(): Promise<unknown>;
  }>,
  input: {
    baseUrl: string;
    path: string;
    headers?: Record<string, string>;
  },
) {
  return await fetch(input.path, {
    headers: {
      forwarded: createForwardedHeaderForBaseUrl(input.baseUrl),
      ...input.headers,
    },
  });
}

function createForwardedHeaderForBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `proto=${url.protocol.slice(0, -1)};host=${url.host}`;
}
