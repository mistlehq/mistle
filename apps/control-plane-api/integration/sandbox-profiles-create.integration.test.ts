/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  SandboxProfileStatuses,
  SandboxProfileVersionAgentRuntimeIds,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { SandboxProvider } from "@mistle/sandbox";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { and, eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  SandboxProfileSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { createApiKeyToken } from "./helpers/api-keys.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox profiles create integration", () => {
  it("creates a sandbox profile in the authenticated user's active organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-create@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        displayName: "Created Profile",
      }),
    });
    expect(response.status).toBe(201);

    const body = SandboxProfileSchema.parse(await response.json());
    expect(body.organizationId).toBe(session.organizationId);
    expect(body.displayName).toBe("Created Profile");
    expect(body.activeVersion).toBeNull();
    expect(body.status).toBe(SandboxProfileStatuses.ACTIVE);

    const persistedProfile = await env.controlPlaneDb.query.sandboxProfiles.findFirst({
      where: (table, { eq }) => eq(table.id, body.id),
    });
    expect(persistedProfile).toBeDefined();
    if (persistedProfile === undefined) {
      throw new Error("Expected created sandbox profile to be persisted.");
    }
    expect(persistedProfile.organizationId).toBe(session.organizationId);
    expect(persistedProfile.displayName).toBe("Created Profile");
    expect(persistedProfile.status).toBe(SandboxProfileStatuses.ACTIVE);
    expect(persistedProfile.activeVersion).toBeNull();

    const persistedVersions = await env.controlPlaneDb.query.sandboxProfileVersions.findMany({
      where: (table, { eq }) => eq(table.sandboxProfileId, body.id),
    });
    expect(persistedVersions).toHaveLength(1);

    const [initialVersion] = persistedVersions;
    if (initialVersion === undefined) {
      throw new Error("Expected initial sandbox profile version to exist.");
    }
    expect(initialVersion.sandboxProfileId).toBe(body.id);
    expect(initialVersion.version).toBe(1);
    expect(initialVersion.state).toBe(SandboxProfileVersionStates.DRAFT);
    expect(initialVersion.agentRuntimeId).toBe(SandboxProfileVersionAgentRuntimeIds.CODEX);
    expect(initialVersion.publishedAt).toBeNull();
    expect(initialVersion.sandboxProvider).toBeNull();
    expect(initialVersion.sandboxVcpuCount).toBeNull();
    expect(initialVersion.sandboxMemoryMb).toBeNull();
    expect(initialVersion.sandboxDiskMb).toBeNull();
  });

  it("persists an explicit initial sandbox provider on the draft version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-create-provider@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        displayName: "Created Mistle Provider Profile",
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    });
    expect(response.status).toBe(201);

    const body = SandboxProfileSchema.parse(await response.json());
    const initialVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      where: (table, { eq }) => eq(table.sandboxProfileId, body.id),
    });

    expect(initialVersion).toBeDefined();
    if (initialVersion === undefined) {
      throw new Error("Expected initial sandbox profile version to exist.");
    }
    expect(initialVersion.version).toBe(1);
    expect(initialVersion.state).toBe(SandboxProfileVersionStates.DRAFT);
    expect(initialVersion.sandboxProvider).toBe(SandboxProvider.DOCKER);
    expect(initialVersion.sandboxConnectionId).toBeNull();
    expect(initialVersion.sandboxVcpuCount).toBeNull();
    expect(initialVersion.sandboxMemoryMb).toBeNull();
    expect(initialVersion.sandboxDiskMb).toBeNull();
  });

  it("rejects creation with an invalid explicit sandbox provider", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-create-invalid-runtime@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        displayName: "Invalid Runtime Profile",
        sandboxProvider: "unsupported-provider",
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_SANDBOX_RUNTIME_CONFIG",
      message: "Sandbox provider 'unsupported-provider' is not supported.",
    });
  });

  it("creates a sandbox profile with an API key that has create permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-create-api-key@example.com",
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: session.cookie,
      name: "Profile create key",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_CREATE],
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKeyToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        displayName: "API Key Created Profile",
      }),
    });
    expect(response.status).toBe(201);

    const body = SandboxProfileSchema.parse(await response.json());
    expect(body.organizationId).toBe(session.organizationId);
    expect(body.displayName).toBe("API Key Created Profile");

    const persistedProfile = await env.controlPlaneDb.query.sandboxProfiles.findFirst({
      columns: {
        id: true,
        organizationId: true,
        displayName: true,
      },
      where: (table, { eq }) => eq(table.id, body.id),
    });
    expect(persistedProfile).toEqual({
      id: body.id,
      organizationId: session.organizationId,
      displayName: "API Key Created Profile",
    });
  });

  it("returns 403 when an API key does not have create permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-create-api-key-forbidden@example.com",
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: session.cookie,
      name: "Profile read key",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKeyToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        displayName: "Should Fail",
      }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("rejects creation when status is provided", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-create-status-not-allowed@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        displayName: "Created Profile",
        status: SandboxProfileStatuses.INACTIVE,
      }),
    });
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toBe("Invalid request.");
  });

  it("rejects creation without an authenticated session", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        displayName: "Unauthenticated",
      }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid create payload", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-create-validation@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        displayName: "",
      }),
    });
    expect(response.status).toBe(400);

    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toBe("Invalid request.");
  });

  it("does not create a profile in another organization", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-create-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-create-org-b@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: firstOrgSession.cookie,
      },
      body: JSON.stringify({
        displayName: "Org A Created Profile",
      }),
    });
    expect(response.status).toBe(201);
    const createdProfile = SandboxProfileSchema.parse(await response.json());

    const secondOrgProfiles = await env.controlPlaneDb.query.sandboxProfiles.findMany({
      where: (table, { eq }) => eq(table.organizationId, secondOrgSession.organizationId),
    });
    expect(secondOrgProfiles.map((profile) => profile.id)).not.toContain(createdProfile.id);

    const firstOrgProfile = await env.controlPlaneDb.query.sandboxProfiles.findFirst({
      where: (table, { eq }) => eq(table.id, createdProfile.id),
    });
    expect(firstOrgProfile).toBeDefined();
    if (firstOrgProfile === undefined) {
      throw new Error("Expected created sandbox profile to exist.");
    }
    expect(firstOrgProfile.organizationId).toBe(firstOrgSession.organizationId);
  });

  it("returns 403 when the active organization membership has been revoked", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-create-revoked-membership@example.com",
    });

    await env.controlPlaneDb
      .delete(env.controlPlaneTables.members)
      .where(
        and(
          eq(env.controlPlaneTables.members.organizationId, session.organizationId),
          eq(env.controlPlaneTables.members.userId, session.userId),
        ),
      );

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        displayName: "Should Fail",
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });
});
