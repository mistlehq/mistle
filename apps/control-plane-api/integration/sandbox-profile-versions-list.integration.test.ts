import {
  sandboxProfiles,
  sandboxProfileVersions,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  ListSandboxProfileVersionsResponseSchema,
  NotFoundResponseSchema,
} from "../src/sandbox-profiles/index.js";
import {
  createSandboxProfileFixture,
  createSandboxProfileVersionFixture,
} from "./helpers/sandbox-profiles.js";
import { it } from "./test-context.js";

describe("sandbox profile versions list integration", () => {
  it("returns profile versions ordered by version descending", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-versions-list@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_versions_list_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Versions List Profile",
        activeVersion: 2,
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values([
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_versions_list_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
      }),
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_versions_list_001",
        version: 2,
        state: SandboxProfileVersionStates.PUBLISHED,
      }),
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_versions_list_001",
        version: 3,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    ]);

    const response = await fixture.request("/v1/sandbox/profiles/sbp_versions_list_001/versions", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(200);
    const responseBody = ListSandboxProfileVersionsResponseSchema.parse(await response.json());
    expect(responseBody.versions).toEqual([
      {
        sandboxProfileId: "sbp_versions_list_001",
        version: 3,
        state: SandboxProfileVersionStates.DRAFT,
        isActive: false,
      },
      {
        sandboxProfileId: "sbp_versions_list_001",
        version: 2,
        state: SandboxProfileVersionStates.PUBLISHED,
        isActive: true,
      },
      {
        sandboxProfileId: "sbp_versions_list_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        isActive: false,
      },
    ]);
  }, 60_000);

  it("marks all versions inactive when the profile has not published yet", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-versions-list-draft-only@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_versions_list_draft_only_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Draft Only Profile",
        activeVersion: null,
        createdAt: "2026-03-02T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      ...createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_versions_list_draft_only_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_versions_list_draft_only_001/versions",
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = ListSandboxProfileVersionsResponseSchema.parse(await response.json());
    expect(responseBody.versions).toEqual([
      {
        sandboxProfileId: "sbp_versions_list_draft_only_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        isActive: false,
      },
    ]);
  }, 60_000);

  it("returns 404 when profile is outside authenticated organization", async ({ fixture }) => {
    const firstOrgSession = await fixture.authSession({
      email: "integration-sandbox-profile-versions-list-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-sandbox-profile-versions-list-org-b@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_versions_list_org_b_001",
        organizationId: secondOrgSession.organizationId,
        displayName: "Org B Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      ...createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_versions_list_org_b_001",
        version: 1,
      }),
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_versions_list_org_b_001/versions",
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = NotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("PROFILE_NOT_FOUND");
  }, 60_000);
});
