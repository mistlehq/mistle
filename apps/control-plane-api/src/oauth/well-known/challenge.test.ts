import { describe, expect, it } from "vitest";

import { createOAuthBearerChallenge } from "./challenge.js";

describe("createOAuthBearerChallenge", () => {
  it("builds a missing-token MCP resource metadata challenge", () => {
    expect(
      createOAuthBearerChallenge({
        kind: "missing_token",
        metadataUrl: "https://mcp.example/.well-known/oauth-protected-resource/mcp",
      }),
    ).toBe(
      'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("builds an invalid-token MCP resource metadata challenge", () => {
    expect(
      createOAuthBearerChallenge({
        kind: "invalid_token",
        metadataUrl: "https://mcp.example/.well-known/oauth-protected-resource/mcp",
      }),
    ).toBe(
      'Bearer error="invalid_token", resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("builds an insufficient-scope MCP resource metadata challenge", () => {
    expect(
      createOAuthBearerChallenge({
        kind: "insufficient_scope",
        metadataUrl: "https://mcp.example/.well-known/oauth-protected-resource/mcp",
        requiredScopes: ["sandboxProfile:read", "sandboxSession:read"],
      }),
    ).toBe(
      'Bearer error="insufficient_scope", scope="sandboxProfile:read sandboxSession:read", resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/mcp"',
    );
  });
});
