import { integrationTargets } from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import { CompleteOAuth2ConnectionBadRequestResponseSchema } from "../src/integration-connections/complete-oauth2-connection/schema.js";
import { StartOAuth2ConnectionBadRequestResponseSchema } from "../src/integration-connections/start-oauth2-connection/schema.js";
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
      StartOAuth2ConnectionBadRequestResponseSchema.parse({
        code: "OAUTH2_NOT_SUPPORTED",
        message: "Integration target 'openai-default-oauth2-start' does not support OAuth2.",
      }),
    );
  });

  it("returns a route error instead of auth middleware for OAuth2 completion without a session", async ({
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
      "/v1/integration/connections/openai-default-oauth2-complete/oauth2/complete?state=missing",
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      CompleteOAuth2ConnectionBadRequestResponseSchema.parse({
        code: "OAUTH2_NOT_SUPPORTED",
        message: "Integration target 'openai-default-oauth2-complete' does not support OAuth2.",
      }),
    );
  });
});
