/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxProfileStatuses } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { NotFoundResponseSchema, SandboxProfileSchema } from "../src/sandbox-profiles/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe("sandbox profiles get integration", () => {
  it("returns a sandbox profile in the authenticated user's active organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-get@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_get_001",
      organizationId: session.organizationId,
      displayName: "Get Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles/sbp_get_001", {
      headers: {
        cookie: session.cookie,
      },
    });
    expect(response.status).toBe(200);

    const body = SandboxProfileSchema.parse(await response.json());
    expect(body.id).toBe("sbp_get_001");
    expect(body.organizationId).toBe(session.organizationId);
    expect(body.displayName).toBe("Get Profile");
    expect(body.activeVersion).toBeNull();
  });

  it("returns 401 when no authenticated session is provided", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles/sbp_get_unauth");
    expect(response.status).toBe(401);
  });

  it("returns 404 for profiles outside the authenticated user's organization", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-get-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-get-org-b@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_get_org_b_001",
      organizationId: secondOrgSession.organizationId,
      displayName: "Org B Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_get_org_b_001",
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );
    expect(response.status).toBe(404);

    const body = NotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_NOT_FOUND");
  });
});
