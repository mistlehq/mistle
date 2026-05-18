/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxProfileStatuses } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { RequestDeleteSandboxProfileWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { describe, expect } from "vitest";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  NotFoundResponseSchema,
  SandboxProfileDeletionAcceptedResponseSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { createApiKeyToken } from "./helpers/api-keys.js";
import { waitForQueuedControlPlaneWorkflowInput } from "./helpers/control-plane-workflows.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox profiles request delete integration", () => {
  it("accepts deletion and enqueues the sandbox profile deletion workflow", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-request-delete@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_delete_001",
      organizationId: session.organizationId,
      displayName: "Delete Me",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles/sbp_delete_001", {
      method: "DELETE",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(202);
    expect(SandboxProfileDeletionAcceptedResponseSchema.parse(await response.json())).toEqual({
      status: "accepted",
      profileId: "sbp_delete_001",
    });

    const workflowInput = await waitForQueuedControlPlaneWorkflowInput({
      env,
      workflowName: RequestDeleteSandboxProfileWorkflowSpec.name,
      inputEquals: {
        organizationId: session.organizationId,
        profileId: "sbp_delete_001",
      },
    });
    expect(workflowInput).toMatchObject({
      organizationId: session.organizationId,
      profileId: "sbp_delete_001",
    });

    const persistedProfile = await env.controlPlaneDb.query.sandboxProfiles.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.id, "sbp_delete_001"), eq(table.organizationId, session.organizationId)),
    });
    expect(persistedProfile).toEqual({
      id: "sbp_delete_001",
    });
  });

  it("accepts deletion with an API key that has delete permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-request-delete-api-key@example.com",
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: session.cookie,
      name: "Profile delete key",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_DELETE],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_delete_api_key_001",
      organizationId: session.organizationId,
      displayName: "API Key Delete Me",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_delete_api_key_001",
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${apiKeyToken}`,
        },
      },
    );

    expect(response.status).toBe(202);
    expect(SandboxProfileDeletionAcceptedResponseSchema.parse(await response.json())).toEqual({
      status: "accepted",
      profileId: "sbp_delete_api_key_001",
    });

    const workflowInput = await waitForQueuedControlPlaneWorkflowInput({
      env,
      workflowName: RequestDeleteSandboxProfileWorkflowSpec.name,
      inputEquals: {
        organizationId: session.organizationId,
        profileId: "sbp_delete_api_key_001",
      },
    });
    expect(workflowInput).toMatchObject({
      organizationId: session.organizationId,
      profileId: "sbp_delete_api_key_001",
    });
  });

  it("returns 403 when an API key does not have delete permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-request-delete-api-key-forbidden@example.com",
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: session.cookie,
      name: "Profile read key",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_delete_api_key_forbidden",
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${apiKeyToken}`,
        },
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
      "/v1/sandbox/profiles/sbp_delete_unauth",
      {
        method: "DELETE",
      },
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid profile id params", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-delete-validation@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/invalid-profile-id",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(400);
    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toBe("Invalid request.");
  });

  it("returns 404 for profiles outside the authenticated user's organization", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-delete-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-delete-org-b@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_delete_org_b_001",
      organizationId: secondOrgSession.organizationId,
      displayName: "Org B Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_delete_org_b_001",
      {
        method: "DELETE",
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
