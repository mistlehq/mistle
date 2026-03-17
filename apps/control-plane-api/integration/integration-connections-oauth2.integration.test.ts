import { integrationTargets } from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import { IntegrationConnectionsBadRequestResponseSchema } from "../src/integration-connections/contracts.js";
import { encryptIntegrationTargetSecrets } from "../src/integration-credentials/crypto.js";
import { it } from "./test-context.js";

describe("integration connections OAuth2 integration", () => {
  it("returns 400 when a target does not support OAuth2 start", async ({ fixture }) => {
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-oauth2-start",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth2-start@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/openai-default-oauth2-start/oauth2/start",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      IntegrationConnectionsBadRequestResponseSchema.parse({
        code: "OAUTH2_NOT_SUPPORTED",
        message: "Integration target 'openai-default-oauth2-start' does not support OAuth2.",
      }),
    );
  });

  it("starts Notion OAuth2 connections with the expected authorization url", async ({
    fixture,
  }) => {
    const encryptedSecrets = encryptIntegrationTargetSecrets({
      secrets: {
        client_id: "notion-client-id",
        client_secret: "notion-client-secret",
      },
      masterKeyVersion: 1,
      masterEncryptionKeyMaterial: "integration-master-key-testing",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "notion-default-oauth2-start",
      familyId: "notion",
      variantId: "notion-default",
      enabled: true,
      config: {
        mcp_base_url: "https://notion-mcp.example.com/mcp",
        authorization_endpoint: "https://api.notion.com/v1/oauth/authorize",
        token_endpoint: "https://api.notion.com/v1/oauth/token",
        notion_version: "2026-03-11",
      },
      secrets: encryptedSecrets,
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth2-start-notion@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/notion-default-oauth2-start/oauth2/start",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Notion Workspace",
        }),
      },
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      authorizationUrl: string;
    };
    const authorizationUrl = new URL(body.authorizationUrl);

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://api.notion.com/v1/oauth/authorize",
    );
    expect(authorizationUrl.searchParams.get("owner")).toBe("user");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("notion-client-id");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      `${fixture.config.auth.baseUrl}/v1/integration/connections/notion-default-oauth2-start/oauth2/complete`,
    );

    const persistedSessions = await fixture.db.query.integrationConnectionRedirectSessions.findMany(
      {
        where: (table, { eq }) => eq(table.targetKey, "notion-default-oauth2-start"),
        columns: {
          id: true,
          state: true,
          usedAt: true,
        },
      },
    );

    expect(persistedSessions).toHaveLength(1);
    expect(persistedSessions[0]?.usedAt).toBeNull();
    expect(authorizationUrl.searchParams.get("state")).toBe(persistedSessions[0]?.state ?? null);
  });
});
