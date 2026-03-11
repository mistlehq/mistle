import {
  SandboxProfileStatuses,
  sandboxProfiles,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  ListSandboxProfileVersionsResponseSchema,
  NotFoundResponseSchema,
} from "../src/sandbox-profiles/contracts.js";
import { it } from "./test-context.js";

describe("sandbox profile versions list integration", () => {
  it("returns profile versions ordered by version descending", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-versions-list@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_versions_list_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Versions List Profile",
      status: SandboxProfileStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersions).values([
      {
        sandboxProfileId: "sbp_versions_list_001",
        version: 1,
      },
      {
        sandboxProfileId: "sbp_versions_list_001",
        version: 2,
      },
      {
        sandboxProfileId: "sbp_versions_list_001",
        version: 3,
      },
    ]);

    const response = await fixture.request("/v1/sandbox/profiles/sbp_versions_list_001/versions", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(200);
    const responseBody = ListSandboxProfileVersionsResponseSchema.parse(await response.json());
    expect(responseBody.versions.map((version) => version.version)).toEqual([3, 2, 1]);
  }, 60_000);

  it("returns 404 when profile is outside authenticated organization", async ({ fixture }) => {
    const firstOrgSession = await fixture.authSession({
      email: "integration-sandbox-profile-versions-list-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-sandbox-profile-versions-list-org-b@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_versions_list_org_b_001",
      organizationId: secondOrgSession.organizationId,
      displayName: "Org B Profile",
      status: SandboxProfileStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_versions_list_org_b_001",
      version: 1,
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
