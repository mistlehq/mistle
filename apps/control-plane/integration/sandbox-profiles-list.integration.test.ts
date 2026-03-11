import { SandboxProfileStatuses, sandboxProfiles } from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  ListSandboxProfilesResponseSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/contracts.js";
import { it } from "./test-context.js";

describe("sandbox profiles list integration", () => {
  it("returns keyset paginated profiles envelope with next and previous page pointers", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-list@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values([
      {
        id: "sbp_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Profile 1",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "sbp_002",
        organizationId: authenticatedSession.organizationId,
        displayName: "Profile 2",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "sbp_003",
        organizationId: authenticatedSession.organizationId,
        displayName: "Profile 3",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    ]);

    const firstPageResponse = await fixture.request("/v1/sandbox/profiles?limit=2", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(firstPageResponse.status).toBe(200);
    const firstPage = ListSandboxProfilesResponseSchema.parse(await firstPageResponse.json());

    expect(firstPage.totalResults).toBe(3);
    expect(firstPage.items.map((item) => item.id)).toEqual(["sbp_003", "sbp_002"]);
    expect(firstPage.previousPage).toBeNull();
    expect(firstPage.nextPage).not.toBeNull();

    if (firstPage.nextPage === null) {
      throw new Error("Expected next page cursor.");
    }

    const secondPageResponse = await fixture.request(
      `/v1/sandbox/profiles?limit=2&after=${encodeURIComponent(firstPage.nextPage.after)}`,
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage = ListSandboxProfilesResponseSchema.parse(await secondPageResponse.json());

    expect(secondPage.totalResults).toBe(3);
    expect(secondPage.items.map((item) => item.id)).toEqual(["sbp_001"]);
    expect(secondPage.nextPage).toBeNull();
    expect(secondPage.previousPage).not.toBeNull();

    if (secondPage.previousPage === null) {
      throw new Error("Expected previous page cursor.");
    }

    const previousPageResponse = await fixture.request(
      `/v1/sandbox/profiles?limit=2&before=${encodeURIComponent(secondPage.previousPage.before)}`,
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(previousPageResponse.status).toBe(200);
    const previousPage = ListSandboxProfilesResponseSchema.parse(await previousPageResponse.json());

    expect(previousPage.totalResults).toBe(3);
    expect(previousPage.items.map((item) => item.id)).toEqual(["sbp_003", "sbp_002"]);
  });

  it("returns 400 for invalid pagination cursor", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-invalid-cursor@example.com",
    });

    const response = await fixture.request("/v1/sandbox/profiles?after=invalid-cursor", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(400);

    const bodyText = await response.text();
    expect(bodyText).toContain('"code":"INVALID_PAGINATION_CURSOR"');
  });

  it("returns 400 for invalid list query payload", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-list-validation@example.com",
    });

    const response = await fixture.request("/v1/sandbox/profiles?after=abc&before=def", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.success).toBe(false);
    expect(body.error.name).toBe("ZodError");
  });

  it("does not return profiles from another organization", async ({ fixture }) => {
    const firstOrgSession = await fixture.authSession({
      email: "integration-sandbox-profiles-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-sandbox-profiles-org-b@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values([
      {
        id: "sbp_a_001",
        organizationId: firstOrgSession.organizationId,
        displayName: "Org A Profile 1",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "sbp_a_002",
        organizationId: firstOrgSession.organizationId,
        displayName: "Org A Profile 2",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "sbp_b_001",
        organizationId: secondOrgSession.organizationId,
        displayName: "Org B Profile 1",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    ]);

    const firstOrgResponse = await fixture.request("/v1/sandbox/profiles", {
      headers: {
        cookie: firstOrgSession.cookie,
      },
    });
    expect(firstOrgResponse.status).toBe(200);
    const firstOrgList = ListSandboxProfilesResponseSchema.parse(await firstOrgResponse.json());
    expect(firstOrgList.totalResults).toBe(2);
    expect(firstOrgList.items.map((item) => item.id)).toEqual(["sbp_a_002", "sbp_a_001"]);

    const secondOrgResponse = await fixture.request("/v1/sandbox/profiles", {
      headers: {
        cookie: secondOrgSession.cookie,
      },
    });
    expect(secondOrgResponse.status).toBe(200);
    const secondOrgList = ListSandboxProfilesResponseSchema.parse(await secondOrgResponse.json());
    expect(secondOrgList.totalResults).toBe(1);
    expect(secondOrgList.items.map((item) => item.id)).toEqual(["sbp_b_001"]);
  });
});
