import {
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  ListIntegrationConnectionsResponseSchema,
  ValidationErrorResponseSchema,
} from "../src/integration-connections/contracts.js";
import { it } from "./test-context.js";

describe("integration connections list integration", () => {
  it("returns keyset paginated integration connections scoped to active organization", async ({
    fixture,
  }) => {
    const firstOrgSession = await fixture.authSession({
      email: "integration-connections-list-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-connections-list-org-b@example.com",
    });

    await fixture.db.insert(integrationTargets).values([
      {
        targetKey: "github_cloud",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          base_url: "https://github.com",
        },
      },
      {
        targetKey: "openai-default",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com",
        },
      },
    ]);

    const firstConnectionCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const secondConnectionCreatedAt = new Date("2026-01-02T00:00:00.000Z");
    const thirdConnectionCreatedAt = new Date("2026-01-03T00:00:00.000Z");

    await fixture.db.insert(integrationConnections).values([
      {
        id: "icn_001",
        organizationId: firstOrgSession.organizationId,
        targetKey: "github_cloud",
        status: IntegrationConnectionStatuses.ACTIVE,
        externalSubjectId: "github-user-1",
        config: {
          installation_id: "12345",
        },
        targetSnapshotConfig: {
          base_url: "https://github.com",
        },
        createdAt: firstConnectionCreatedAt.toISOString(),
        updatedAt: firstConnectionCreatedAt.toISOString(),
      },
      {
        id: "icn_002",
        organizationId: firstOrgSession.organizationId,
        targetKey: "openai-default",
        status: IntegrationConnectionStatuses.ERROR,
        createdAt: secondConnectionCreatedAt.toISOString(),
        updatedAt: secondConnectionCreatedAt.toISOString(),
      },
      {
        id: "icn_003",
        organizationId: firstOrgSession.organizationId,
        targetKey: "github_cloud",
        status: IntegrationConnectionStatuses.REVOKED,
        createdAt: thirdConnectionCreatedAt.toISOString(),
        updatedAt: thirdConnectionCreatedAt.toISOString(),
      },
      {
        id: "icn_004",
        organizationId: secondOrgSession.organizationId,
        targetKey: "github_cloud",
        status: IntegrationConnectionStatuses.ACTIVE,
        createdAt: thirdConnectionCreatedAt.toISOString(),
        updatedAt: thirdConnectionCreatedAt.toISOString(),
      },
    ]);

    const firstPageResponse = await fixture.request("/v1/integration/connections?limit=2", {
      headers: {
        cookie: firstOrgSession.cookie,
      },
    });
    expect(firstPageResponse.status).toBe(200);
    const firstPage = ListIntegrationConnectionsResponseSchema.parse(
      await firstPageResponse.json(),
    );
    const normalizedFirstPageItems = firstPage.items.map((item) => ({
      ...item,
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: new Date(item.updatedAt).toISOString(),
    }));

    expect(firstPage.totalResults).toBe(3);
    expect(normalizedFirstPageItems).toEqual([
      {
        id: "icn_001",
        targetKey: "github_cloud",
        status: IntegrationConnectionStatuses.ACTIVE,
        externalSubjectId: "github-user-1",
        config: {
          installation_id: "12345",
        },
        targetSnapshotConfig: {
          base_url: "https://github.com",
        },
        createdAt: firstConnectionCreatedAt.toISOString(),
        updatedAt: firstConnectionCreatedAt.toISOString(),
      },
      {
        id: "icn_002",
        targetKey: "openai-default",
        status: IntegrationConnectionStatuses.ERROR,
        createdAt: secondConnectionCreatedAt.toISOString(),
        updatedAt: secondConnectionCreatedAt.toISOString(),
      },
    ]);
    expect(firstPage.previousPage).toBeNull();
    expect(firstPage.nextPage).not.toBeNull();

    if (firstPage.nextPage === null) {
      throw new Error("Expected next page cursor.");
    }

    const secondPageResponse = await fixture.request(
      `/v1/integration/connections?limit=2&after=${encodeURIComponent(firstPage.nextPage.after)}`,
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage = ListIntegrationConnectionsResponseSchema.parse(
      await secondPageResponse.json(),
    );
    const normalizedSecondPageItems = secondPage.items.map((item) => ({
      ...item,
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: new Date(item.updatedAt).toISOString(),
    }));

    expect(secondPage.totalResults).toBe(3);
    expect(normalizedSecondPageItems).toEqual([
      {
        id: "icn_003",
        targetKey: "github_cloud",
        status: IntegrationConnectionStatuses.REVOKED,
        createdAt: thirdConnectionCreatedAt.toISOString(),
        updatedAt: thirdConnectionCreatedAt.toISOString(),
      },
    ]);
    expect(secondPage.nextPage).toBeNull();
    expect(secondPage.previousPage).not.toBeNull();

    if (secondPage.previousPage === null) {
      throw new Error("Expected previous page cursor.");
    }

    const previousPageResponse = await fixture.request(
      `/v1/integration/connections?limit=2&before=${encodeURIComponent(secondPage.previousPage.before)}`,
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );
    expect(previousPageResponse.status).toBe(200);
    const previousPage = ListIntegrationConnectionsResponseSchema.parse(
      await previousPageResponse.json(),
    );

    expect(previousPage.totalResults).toBe(3);
    expect(previousPage.items.map((connection) => connection.id)).toEqual(["icn_001", "icn_002"]);
  }, 60_000);

  it("returns 400 for invalid pagination cursor", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-list-invalid-cursor@example.com",
    });

    const response = await fixture.request("/v1/integration/connections?after=invalid-cursor", {
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
      email: "integration-connections-list-validation@example.com",
    });

    const response = await fixture.request("/v1/integration/connections?after=abc&before=def", {
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
    const response = await fixture.request("/v1/integration/connections");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  }, 60_000);
});
