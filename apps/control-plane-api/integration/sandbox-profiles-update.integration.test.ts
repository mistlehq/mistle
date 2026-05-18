/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxProfileStatuses } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  NotFoundResponseSchema,
  SandboxProfileSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { createApiKeyToken } from "./helpers/api-keys.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox profiles update integration", () => {
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

  it("updates a sandbox profile with an API key that has update permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-update-api-key@example.com",
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: session.cookie,
      name: "Profile update key",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_UPDATE],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_update_api_key_001",
      organizationId: session.organizationId,
      displayName: "Before API Key Update",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-04T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_update_api_key_001",
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${apiKeyToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          displayName: "After API Key Update",
        }),
      },
    );
    expect(response.status).toBe(200);

    const body = SandboxProfileSchema.parse(await response.json());
    expect(body.id).toBe("sbp_update_api_key_001");
    expect(body.organizationId).toBe(session.organizationId);
    expect(body.displayName).toBe("After API Key Update");
  });

  it("returns 403 when an API key does not have update permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-update-api-key-forbidden@example.com",
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: session.cookie,
      name: "Profile read key",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_update_api_key_forbidden",
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${apiKeyToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          displayName: "Should Fail",
        }),
      },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
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

  it("returns 404 when an API key updates a profile outside its organization", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-update-api-key-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-update-api-key-org-b@example.com",
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: firstOrgSession.cookie,
      name: "Profile update key",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_UPDATE],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_update_api_key_org_b_001",
      organizationId: secondOrgSession.organizationId,
      displayName: "Org B Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-05T00:00:00.000Z",
      updatedAt: "2026-01-05T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_update_api_key_org_b_001",
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${apiKeyToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          displayName: "Unauthorized API Key Update Attempt",
        }),
      },
    );
    expect(response.status).toBe(404);

    const body = NotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_NOT_FOUND");
  });
});
