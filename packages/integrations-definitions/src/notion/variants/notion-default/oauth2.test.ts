import { describe, expect, it } from "vitest";

import {
  buildNotionAuthorizationUrl,
  classifyNotionTokenEndpointFailure,
  NotionOAuth2Capability,
  parseNotionTokenEndpointBody,
} from "./oauth2.js";

describe("NotionOAuth2Capability", () => {
  it("builds the expected authorization url", async () => {
    const started = await NotionOAuth2Capability.startAuthorization({
      organizationId: "org_123",
      targetKey: "notion-default",
      target: {
        familyId: "notion",
        variantId: "notion-default",
        enabled: true,
        config: {
          mcpBaseUrl: "https://notion-mcp.example.com/mcp",
          authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
          tokenEndpoint: "https://api.notion.com/v1/oauth/token",
          notionVersion: "2026-03-11",
        },
        secrets: {
          clientId: "client-id",
          clientSecret: "client-secret",
        },
      },
      state: "state_123",
      redirectUrl:
        "https://control-plane.example.com/v1/integration/connections/notion-default/oauth2/complete",
      pkce: {
        challenge: "challenge_123",
        challengeMethod: "S256",
      },
    });

    expect(started.authorizationUrl).toBe(
      buildNotionAuthorizationUrl({
        authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
        clientId: "client-id",
        redirectUrl:
          "https://control-plane.example.com/v1/integration/connections/notion-default/oauth2/complete",
        state: "state_123",
      }),
    );
  });

  it("fails fast when the callback contains an authorization error", async () => {
    await expect(
      NotionOAuth2Capability.completeAuthorizationCodeGrant({
        organizationId: "org_123",
        targetKey: "notion-default",
        target: {
          familyId: "notion",
          variantId: "notion-default",
          enabled: true,
          config: {
            mcpBaseUrl: "https://notion-mcp.example.com/mcp",
            authorizationEndpoint: "https://api.notion.com/v1/oauth/authorize",
            tokenEndpoint: "https://api.notion.com/v1/oauth/token",
            notionVersion: "2026-03-11",
          },
          secrets: {
            clientId: "client-id",
            clientSecret: "client-secret",
          },
        },
        query: new URLSearchParams({
          error: "access_denied",
          error_description: "User rejected the integration.",
        }),
        redirectUrl:
          "https://control-plane.example.com/v1/integration/connections/notion-default/oauth2/complete",
      }),
    ).rejects.toThrowError(
      "Notion OAuth authorization failed with 'access_denied': User rejected the integration.",
    );
  });

  it("parses token endpoint success bodies", () => {
    expect(
      parseNotionTokenEndpointBody({
        body: {
          access_token: "access-token",
          token_type: "bearer",
          bot_id: "bot_123",
          workspace_id: "workspace_123",
          workspace_name: "Acme Workspace",
          refresh_token: "refresh-token",
        },
      }),
    ).toMatchObject({
      access_token: "access-token",
      bot_id: "bot_123",
      workspace_id: "workspace_123",
      workspace_name: "Acme Workspace",
      refresh_token: "refresh-token",
    });
  });

  it("classifies rate limits and server failures as temporary", () => {
    expect(classifyNotionTokenEndpointFailure({ status: 429 })).toBe("temporary");
    expect(classifyNotionTokenEndpointFailure({ status: 503 })).toBe("temporary");
  });

  it("classifies client errors as permanent", () => {
    expect(
      classifyNotionTokenEndpointFailure({
        status: 400,
        code: "invalid_grant",
      }),
    ).toBe("permanent");
  });
});
