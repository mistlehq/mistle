import { SandboxProfileStatuses, sandboxProfiles } from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  NotFoundResponseSchema,
  SandboxProfileSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/contracts.js";
import { it } from "./test-context.js";

describe("sandbox profiles update integration", () => {
  it("updates a sandbox profile in the authenticated user's active organization", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-update@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_update_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Before Update",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const response = await fixture.request("/v1/sandbox/profiles/sbp_update_001", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "After Update",
        status: SandboxProfileStatuses.INACTIVE,
      }),
    });
    expect(response.status).toBe(200);

    const body = SandboxProfileSchema.parse(await response.json());
    expect(body.id).toBe("sbp_update_001");
    expect(body.organizationId).toBe(authenticatedSession.organizationId);
    expect(body.displayName).toBe("After Update");
    expect(body.status).toBe(SandboxProfileStatuses.INACTIVE);
    expect(body.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  }, 60_000);

  it("returns 401 when no authenticated session is provided", async ({ fixture }) => {
    const response = await fixture.request("/v1/sandbox/profiles/sbp_update_unauth", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        displayName: "Should Fail",
      }),
    });
    expect(response.status).toBe(401);
  }, 60_000);

  it("returns 400 for invalid update payload", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-update-validation@example.com",
    });

    const response = await fixture.request("/v1/sandbox/profiles/sbp_update_validation_001", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.success).toBe(false);
    expect(body.error.name).toBe("ZodError");
  }, 60_000);

  it("returns 404 for profiles outside the authenticated user's organization", async ({
    fixture,
  }) => {
    const firstOrgSession = await fixture.authSession({
      email: "integration-sandbox-profiles-update-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-sandbox-profiles-update-org-b@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_update_org_b_001",
      organizationId: secondOrgSession.organizationId,
      displayName: "Org B Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const response = await fixture.request("/v1/sandbox/profiles/sbp_update_org_b_001", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: firstOrgSession.cookie,
      },
      body: JSON.stringify({
        displayName: "Unauthorized Update Attempt",
      }),
    });
    expect(response.status).toBe(404);

    const body = NotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_NOT_FOUND");
  }, 60_000);
});
