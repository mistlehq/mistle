import { SandboxProfileStatuses, sandboxProfiles } from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import { NotFoundResponseSchema, SandboxProfileSchema } from "../src/sandbox-profiles/contracts.js";
import { it } from "./test-context.js";

describe("sandbox profiles get integration", () => {
  it("returns a sandbox profile in the authenticated user's active organization", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-get@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_get_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Get Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const response = await fixture.request("/v1/sandbox/profiles/sbp_get_001", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(200);

    const body = SandboxProfileSchema.parse(await response.json());
    expect(body.id).toBe("sbp_get_001");
    expect(body.organizationId).toBe(authenticatedSession.organizationId);
    expect(body.displayName).toBe("Get Profile");
  });

  it("returns 401 when no authenticated session is provided", async ({ fixture }) => {
    const response = await fixture.request("/v1/sandbox/profiles/sbp_get_unauth");
    expect(response.status).toBe(401);
  });

  it("returns 404 for profiles outside the authenticated user's organization", async ({
    fixture,
  }) => {
    const firstOrgSession = await fixture.authSession({
      email: "integration-sandbox-profiles-get-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-sandbox-profiles-get-org-b@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_get_org_b_001",
      organizationId: secondOrgSession.organizationId,
      displayName: "Org B Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const response = await fixture.request("/v1/sandbox/profiles/sbp_get_org_b_001", {
      headers: {
        cookie: firstOrgSession.cookie,
      },
    });
    expect(response.status).toBe(404);

    const body = NotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_NOT_FOUND");
  });
});
