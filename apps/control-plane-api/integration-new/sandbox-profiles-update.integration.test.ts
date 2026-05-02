/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxProfileStatuses } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  NotFoundResponseSchema,
  SandboxProfileSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe("sandbox profiles update integration", () => {
  it("updates a sandbox profile in the authenticated user's active organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-update@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_update_001",
      organizationId: session.organizationId,
      displayName: "Before Update",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles/sbp_update_001", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        displayName: "After Update",
      }),
    });
    expect(response.status).toBe(200);

    const body = SandboxProfileSchema.parse(await response.json());
    expect(body.id).toBe("sbp_update_001");
    expect(body.organizationId).toBe(session.organizationId);
    expect(body.displayName).toBe("After Update");
    expect(body.status).toBe(SandboxProfileStatuses.ACTIVE);
    expect(body.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns 401 when no authenticated session is provided", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_update_unauth",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          displayName: "Should Fail",
        }),
      },
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid update payload", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-update-validation@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_update_validation_001",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toBe("Invalid request.");
  });

  it("returns 400 when status is provided in update payload", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-update-status-not-allowed@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_update_validation_002",
      organizationId: session.organizationId,
      displayName: "Before Update",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_update_validation_002",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          status: SandboxProfileStatuses.INACTIVE,
        }),
      },
    );
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toBe("Invalid request.");
  });

  it("returns 404 for profiles outside the authenticated user's organization", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-update-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-update-org-b@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_update_org_b_001",
      organizationId: secondOrgSession.organizationId,
      displayName: "Org B Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_update_org_b_001",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: firstOrgSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Unauthorized Update Attempt",
        }),
      },
    );
    expect(response.status).toBe(404);

    const body = NotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_NOT_FOUND");
  });
});
