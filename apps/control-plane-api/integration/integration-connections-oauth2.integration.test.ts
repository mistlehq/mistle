import { integrationTargets } from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import { IntegrationConnectionsBadRequestResponseSchema } from "../src/integration-connections/contracts.js";
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
});
