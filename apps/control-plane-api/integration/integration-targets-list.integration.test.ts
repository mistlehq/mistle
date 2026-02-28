import { integrationTargets } from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  ListIntegrationTargetsResponseSchema,
  ValidationErrorResponseSchema,
} from "../src/integration-targets/contracts.js";
import { it } from "./test-context.js";

describe("integration targets discovery integration", () => {
  it("returns keyset paginated enabled integration targets for an authenticated session", async ({
    fixture,
  }) => {
    await fixture.db.insert(integrationTargets).values([
      {
        targetKey: "github_cloud",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          base_url: "https://github.com",
          app_id: "123456",
        },
        descriptionOverride: "GitHub Cloud target",
      },
      {
        targetKey: "linear_cloud",
        familyId: "linear",
        variantId: "linear-cloud",
        enabled: true,
        config: {
          base_url: "https://api.linear.app",
        },
      },
      {
        targetKey: "openai_default",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com",
        },
        displayNameOverride: "OpenAI API",
      },
      {
        targetKey: "zzz_disabled_target",
        familyId: "slack",
        variantId: "slack-webhooks",
        enabled: false,
        config: {
          base_url: "https://slack.com/api",
        },
      },
    ]);

    const authenticatedSession = await fixture.authSession({
      email: "integration-targets-list@example.com",
    });

    const firstPageResponse = await fixture.request("/v1/integration/targets?limit=2", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(firstPageResponse.status).toBe(200);
    const firstPage = ListIntegrationTargetsResponseSchema.parse(await firstPageResponse.json());

    expect(firstPage.totalResults).toBe(3);
    expect(firstPage.items).toEqual([
      {
        targetKey: "github_cloud",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          base_url: "https://github.com",
          app_id: "123456",
        },
        descriptionOverride: "GitHub Cloud target",
      },
      {
        targetKey: "linear_cloud",
        familyId: "linear",
        variantId: "linear-cloud",
        enabled: true,
        config: {
          base_url: "https://api.linear.app",
        },
      },
    ]);
    expect(firstPage.previousPage).toBeNull();
    expect(firstPage.nextPage).not.toBeNull();

    if (firstPage.nextPage === null) {
      throw new Error("Expected next page cursor.");
    }

    const secondPageResponse = await fixture.request(
      `/v1/integration/targets?limit=2&after=${encodeURIComponent(firstPage.nextPage.after)}`,
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage = ListIntegrationTargetsResponseSchema.parse(await secondPageResponse.json());

    expect(secondPage.totalResults).toBe(3);
    expect(secondPage.items).toEqual([
      {
        targetKey: "openai_default",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com",
        },
        displayNameOverride: "OpenAI API",
      },
    ]);
    expect(secondPage.nextPage).toBeNull();
    expect(secondPage.previousPage).not.toBeNull();

    if (secondPage.previousPage === null) {
      throw new Error("Expected previous page cursor.");
    }

    const previousPageResponse = await fixture.request(
      `/v1/integration/targets?limit=2&before=${encodeURIComponent(secondPage.previousPage.before)}`,
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(previousPageResponse.status).toBe(200);
    const previousPage = ListIntegrationTargetsResponseSchema.parse(
      await previousPageResponse.json(),
    );

    expect(previousPage.totalResults).toBe(3);
    expect(previousPage.items.map((item) => item.targetKey)).toEqual([
      "github_cloud",
      "linear_cloud",
    ]);
  }, 60_000);

  it("returns 400 for invalid pagination cursor", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-targets-list-invalid-cursor@example.com",
    });

    const response = await fixture.request("/v1/integration/targets?after=invalid-cursor", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(400);

    const bodyText = await response.text();
    expect(bodyText).toContain('"code":"INVALID_PAGINATION_CURSOR"');
  }, 60_000);

  it("returns 400 for invalid list query payload", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-targets-list-validation@example.com",
    });

    const response = await fixture.request("/v1/integration/targets?after=abc&before=def", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.success).toBe(false);
    expect(body.error.name).toBe("ZodError");
  }, 60_000);

  it("returns 401 when the request is unauthenticated", async ({ fixture }) => {
    const response = await fixture.request("/v1/integration/targets");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  }, 60_000);
});
