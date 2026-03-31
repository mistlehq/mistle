import { integrationTargets } from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import { CompleteOAuth2AuthorizationCodeConnectionBadRequestResponseSchema } from "../src/integration-connections/complete-oauth2-authorization-code-connection/schema.js";
import { StartOAuth2AuthorizationCodeConnectionBadRequestResponseSchema } from "../src/integration-connections/start-oauth2-authorization-code-connection/schema.js";
import { it } from "./test-context.js";

describe("integration connections OAuth 2.0 authorization-code integration", () => {
  it("returns 400 when a target does not support OAuth 2.0 (Authorization Code) start", async ({
    fixture,
  }) => {
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
      email: "integration-connections-oauth2-authorization-code-start@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/openai-default-oauth2-start/oauth2-authorization-code/start",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      StartOAuth2AuthorizationCodeConnectionBadRequestResponseSchema.parse({
        code: "OAUTH2_NOT_SUPPORTED",
        message:
          "Integration target 'openai-default-oauth2-start' does not support OAuth 2.0 (Authorization Code).",
      }),
    );
  });

  it("returns a route error instead of auth middleware for OAuth 2.0 (Authorization Code) completion without a session", async ({
    fixture,
  }) => {
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-oauth2-complete",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });

    const response = await fixture.request(
      "/v1/integration/connections/openai-default-oauth2-complete/oauth2-authorization-code/complete?state=missing",
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      CompleteOAuth2AuthorizationCodeConnectionBadRequestResponseSchema.parse({
        code: "OAUTH2_NOT_SUPPORTED",
        message:
          "Integration target 'openai-default-oauth2-complete' does not support OAuth 2.0 (Authorization Code).",
      }),
    );
  });
});
