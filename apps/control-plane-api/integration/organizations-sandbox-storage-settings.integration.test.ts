/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxStorageBackend, SandboxStorageConfigSources } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import {
  GetOrganizationSandboxStorageSettingsResponseSchema,
  PutOrganizationSandboxStorageSettingsResponseSchema,
} from "../src/organizations/schemas.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("organization sandbox storage settings integration", () => {
  it("returns managed defaults when the organization has no explicit storage settings", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-sandbox-storage-defaults@example.com",
    });

    const response = await getSandboxStorageSettings({
      cookie: session.cookie,
      env,
    });

    expect(response.status).toBe(200);
    const payload = GetOrganizationSandboxStorageSettingsResponseSchema.parse(
      await response.json(),
    );
    expect(payload).toEqual({
      persistentSandboxesEnabled: false,
      storageConfigSource: "managed",
      storageBackend: null,
      storageConfigVersion: null,
      organizationStorageConfigSummary: null,
    });
  });

  it("stores organization override settings encrypted and returns redacted summaries", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-sandbox-storage-override@example.com",
    });

    const putResponse = await putSandboxStorageSettings({
      cookie: session.cookie,
      env,
      body: {
        persistentSandboxesEnabled: true,
        storageConfigSource: "organization",
        organizationStorageConfig: {
          backend: "archil",
          apiKey: "archil-api-key",
          region: "aws-us-east-1",
          namePrefix: "org-",
          mounts: [
            {
              type: "s3-compatible",
              bucket: "org-bucket",
              endpoint: "https://storage.example.com",
              accessKeyId: "AKIAORG",
              secretAccessKey: "org-secret-access-key",
            },
          ],
        },
      },
    });

    expect(putResponse.status).toBe(200);
    const payload = PutOrganizationSandboxStorageSettingsResponseSchema.parse(
      await putResponse.json(),
    );
    expect(payload).toEqual({
      persistentSandboxesEnabled: true,
      storageConfigSource: "organization",
      storageBackend: "archil",
      storageConfigVersion: 1,
      organizationStorageConfigSummary: {
        backend: "archil",
        region: "aws-us-east-1",
        namePrefix: "org-",
        apiKeyConfigured: true,
        mounts: [
          {
            type: "s3-compatible",
            bucket: "org-bucket",
            endpoint: "https://storage.example.com",
            accessKeyId: "AKIAORG",
            secretAccessKeyConfigured: true,
          },
        ],
      },
    });

    const storedSettings =
      await env.controlPlaneDb.query.organizationSandboxStorageSettings.findFirst({
        where: (table, { eq }) => eq(table.organizationId, session.organizationId),
      });
    expect(storedSettings).toMatchObject({
      organizationId: session.organizationId,
      persistentSandboxesEnabled: true,
      storageBackend: SandboxStorageBackend.ARCHIL,
      storageConfigSource: SandboxStorageConfigSources.ORGANIZATION,
      storageConfigVersion: 1,
    });
    expect(storedSettings?.storageConfigCiphertext).toEqual(expect.any(String));
    expect(storedSettings?.storageConfigNonce).toEqual(expect.any(String));
    expect(storedSettings?.organizationCredentialKeyVersion).toEqual(expect.any(Number));

    const getResponse = await getSandboxStorageSettings({
      cookie: session.cookie,
      env,
    });
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual(payload);
  });

  it("switches back to managed settings and clears stored override material", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-sandbox-storage-managed@example.com",
    });

    await env.controlPlaneDb
      .insert(env.controlPlaneTables.organizationSandboxStorageSettings)
      .values({
        organizationId: session.organizationId,
        persistentSandboxesEnabled: true,
        storageBackend: SandboxStorageBackend.ARCHIL,
        storageConfigSource: SandboxStorageConfigSources.ORGANIZATION,
        storageConfigVersion: 1,
        storageConfigCiphertext: "ciphertext",
        storageConfigNonce: "nonce",
        organizationCredentialKeyVersion: 1,
      });

    const response = await putSandboxStorageSettings({
      cookie: session.cookie,
      env,
      body: {
        persistentSandboxesEnabled: false,
        storageConfigSource: "managed",
        organizationStorageConfig: null,
      },
    });

    expect(response.status).toBe(200);
    const payload = PutOrganizationSandboxStorageSettingsResponseSchema.parse(
      await response.json(),
    );
    expect(payload).toEqual({
      persistentSandboxesEnabled: false,
      storageConfigSource: "managed",
      storageBackend: null,
      storageConfigVersion: null,
      organizationStorageConfigSummary: null,
    });

    const storedSettings =
      await env.controlPlaneDb.query.organizationSandboxStorageSettings.findFirst({
        where: (table, { eq }) => eq(table.organizationId, session.organizationId),
      });
    expect(storedSettings).toMatchObject({
      organizationId: session.organizationId,
      persistentSandboxesEnabled: false,
      storageBackend: null,
      storageConfigSource: SandboxStorageConfigSources.MANAGED,
      storageConfigVersion: null,
      storageConfigCiphertext: null,
      storageConfigNonce: null,
      organizationCredentialKeyVersion: null,
    });
  });

  it("rejects managed settings when an organization override payload is provided", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-sandbox-storage-managed-contract@example.com",
    });

    const response = await putSandboxStorageSettings({
      cookie: session.cookie,
      env,
      body: {
        persistentSandboxesEnabled: true,
        storageConfigSource: "managed",
        organizationStorageConfig: {
          backend: "archil",
          apiKey: "archil-api-key",
          region: "aws-us-east-1",
          namePrefix: "org-",
          mounts: [
            {
              type: "s3-compatible",
              bucket: "org-bucket",
              endpoint: "https://storage.example.com",
              accessKeyId: "AKIAORG",
              secretAccessKey: "org-secret-access-key",
            },
          ],
        },
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("returns forbidden when a same-organization member reads sandbox storage settings", async ({
    env,
  }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-organization-sandbox-storage-member-read-owner@example.com",
    });
    const memberSession = await env.auth.createSession({
      email: "integration-new-organization-sandbox-storage-member-read-member@example.com",
    });

    await addMemberToActiveOrganization({
      env,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
    });

    const response = await getSandboxStorageSettings({
      cookie: memberSession.cookie,
      env,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("returns forbidden when a same-organization member updates sandbox storage settings", async ({
    env,
  }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-organization-sandbox-storage-member-update-owner@example.com",
    });
    const memberSession = await env.auth.createSession({
      email: "integration-new-organization-sandbox-storage-member-update-member@example.com",
    });

    await addMemberToActiveOrganization({
      env,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
    });

    const response = await putSandboxStorageSettings({
      cookie: memberSession.cookie,
      env,
      body: {
        persistentSandboxesEnabled: true,
        storageConfigSource: "managed",
        organizationStorageConfig: null,
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });
});

async function getSandboxStorageSettings(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
}) {
  return await input.env.controlPlaneApi.http.fetch("/v1/organization/sandbox-storage-settings", {
    method: "GET",
    headers: {
      cookie: input.cookie,
    },
  });
}

async function putSandboxStorageSettings(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  body: unknown;
}) {
  return await input.env.controlPlaneApi.http.fetch("/v1/organization/sandbox-storage-settings", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      cookie: input.cookie,
    },
    body: JSON.stringify(input.body),
  });
}

async function addMemberToActiveOrganization(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.members).values({
    organizationId: input.organizationId,
    userId: input.userId,
    role: "member",
  });

  await input.env.controlPlaneDb
    .update(input.env.controlPlaneTables.sessions)
    .set({
      activeOrganizationId: input.organizationId,
    })
    .where(eq(input.env.controlPlaneTables.sessions.userId, input.userId));
}
