/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { ApiKeyActorKinds, MemberRoles } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { CreateApiKeyResponseSchema } from "../src/api-keys/create-api-key/schema.js";
import { ListApiKeysResponseSchema } from "../src/api-keys/list-api-keys/schema.js";
import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("api keys integration", () => {
  it("creates API keys, returns the token once, and stores only the secret hash", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-api-key-create@example.com",
    });

    const response = await createApiKey({
      cookie: session.cookie,
      env,
      name: "CLI key",
      permissions: [OrganizationPermissions.SANDBOX_SESSION_CREATE],
    });

    expect(response.status).toBe(201);
    const body = CreateApiKeyResponseSchema.parse(await response.json());

    expect(body.token).toMatch(/^mstl_apk_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/u);
    expect(body.apiKey).toMatchObject({
      name: "CLI key",
      secretPrefix: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/u),
      permissions: [OrganizationPermissions.SANDBOX_SESSION_CREATE],
      expiresAt: null,
      lastUsedAt: null,
    });
    expect(body.token.startsWith(`mstl_apk_${body.apiKey.secretPrefix}_`)).toBe(true);

    const persistedApiKey = await env.controlPlaneDb.query.apiKeys.findFirst({
      where: (table, { eq }) => eq(table.id, body.apiKey.id),
    });
    expect(persistedApiKey).toMatchObject({
      organizationId: session.organizationId,
      name: "CLI key",
      secretPrefix: body.apiKey.secretPrefix,
      secretHashAlgorithm: "sha256-v1",
      createdByActorKind: ApiKeyActorKinds.USER,
      createdByActorId: session.userId,
      revokedAt: null,
    });
    expect(persistedApiKey?.secretHash).not.toBe(body.token);
    expect(persistedApiKey?.secretHash).toHaveLength(43);
  });

  it("lists active API keys using keyset pagination and omits revoked keys", async ({ env }) => {
    const firstSession = await env.auth.createSession({
      email: "integration-new-api-key-list-a@example.com",
    });
    const secondSession = await env.auth.createSession({
      email: "integration-new-api-key-list-b@example.com",
    });

    await seedApiKey(env, {
      id: "apk_integration_list_first",
      organizationId: firstSession.organizationId,
      name: "First",
      secretPrefix: "prefix_integration_list_first",
      createdByActorId: firstSession.userId,
      createdAt: "2026-01-01T00:00:00.000Z",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });
    await seedApiKey(env, {
      id: "apk_integration_list_second",
      organizationId: firstSession.organizationId,
      name: "Second",
      secretPrefix: "prefix_integration_list_second",
      createdByActorId: firstSession.userId,
      createdAt: "2026-01-02T00:00:00.000Z",
      permissions: [OrganizationPermissions.SANDBOX_SESSION_CREATE],
    });
    await seedApiKey(env, {
      id: "apk_integration_list_third",
      organizationId: firstSession.organizationId,
      name: "Third",
      secretPrefix: "prefix_integration_list_third",
      createdByActorId: firstSession.userId,
      createdAt: "2026-01-03T00:00:00.000Z",
      permissions: [OrganizationPermissions.INTEGRATION_CONNECTION_READ],
    });
    await seedApiKey(env, {
      id: "apk_integration_list_revoked",
      organizationId: firstSession.organizationId,
      name: "Revoked",
      secretPrefix: "prefix_integration_list_revoked",
      createdByActorId: firstSession.userId,
      createdAt: "2026-01-04T00:00:00.000Z",
      revokedAt: "2026-01-05T00:00:00.000Z",
      permissions: [OrganizationPermissions.ORGANIZATION_READ],
    });
    await seedApiKey(env, {
      id: "apk_integration_list_other_org",
      organizationId: secondSession.organizationId,
      name: "Other Org",
      secretPrefix: "prefix_integration_list_other_org",
      createdByActorId: secondSession.userId,
      createdAt: "2026-01-05T00:00:00.000Z",
      permissions: [OrganizationPermissions.ORGANIZATION_READ],
    });

    const firstPage = await listApiKeys({
      cookie: firstSession.cookie,
      env,
      query: "limit=2",
    });

    expect(firstPage.totalResults).toBe(3);
    expect(firstPage.items.map((apiKey) => apiKey.id)).toStrictEqual([
      "apk_integration_list_third",
      "apk_integration_list_second",
    ]);
    expect(firstPage.items[0]).not.toHaveProperty("secretHash");
    expect(firstPage.previousPage).toBeNull();
    expect(firstPage.nextPage).not.toBeNull();
    if (firstPage.nextPage === null) {
      throw new Error("Expected next page cursor.");
    }

    const secondPage = await listApiKeys({
      cookie: firstSession.cookie,
      env,
      query: `limit=2&after=${encodeURIComponent(firstPage.nextPage.after)}`,
    });

    expect(secondPage.totalResults).toBe(3);
    expect(secondPage.items.map((apiKey) => apiKey.id)).toStrictEqual([
      "apk_integration_list_first",
    ]);
    expect(secondPage.nextPage).toBeNull();
    expect(secondPage.previousPage).not.toBeNull();
  });

  it("soft-revokes API keys through DELETE and keeps repeated deletes idempotent", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-api-key-delete@example.com",
    });
    await seedApiKey(env, {
      id: "apk_integration_delete",
      organizationId: session.organizationId,
      name: "Delete me",
      secretPrefix: "prefix_integration_delete",
      createdByActorId: session.userId,
      createdAt: "2026-02-01T00:00:00.000Z",
      permissions: [OrganizationPermissions.ORGANIZATION_READ],
    });

    const firstDeleteResponse = await deleteApiKey({
      apiKeyId: "apk_integration_delete",
      cookie: session.cookie,
      env,
    });
    expect(firstDeleteResponse.status).toBe(204);

    const secondDeleteResponse = await deleteApiKey({
      apiKeyId: "apk_integration_delete",
      cookie: session.cookie,
      env,
    });
    expect(secondDeleteResponse.status).toBe(204);

    const persistedApiKey = await env.controlPlaneDb.query.apiKeys.findFirst({
      where: (table, { eq }) => eq(table.id, "apk_integration_delete"),
    });
    expect(persistedApiKey?.revokedAt).not.toBeNull();
    expect(persistedApiKey?.revokedByActorKind).toBe(ApiKeyActorKinds.USER);
    expect(persistedApiKey?.revokedByActorId).toBe(session.userId);

    const listAfterDelete = await listApiKeys({
      cookie: session.cookie,
      env,
      query: "limit=10",
    });
    expect(listAfterDelete.items.some((apiKey) => apiKey.id === "apk_integration_delete")).toBe(
      false,
    );
  });

  it("forbids member-role users from managing API keys", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-api-key-member@example.com",
    });
    await env.controlPlaneDb
      .update(env.controlPlaneTables.members)
      .set({
        role: MemberRoles.MEMBER,
      })
      .where(eq(env.controlPlaneTables.members.organizationId, session.organizationId));

    const response = await createApiKey({
      cookie: session.cookie,
      env,
      name: "Denied",
      permissions: [OrganizationPermissions.ORGANIZATION_READ],
    });

    expect(response.status).toBe(403);
  });

  it("returns 404 when deleting an API key outside the active organization", async ({ env }) => {
    const firstSession = await env.auth.createSession({
      email: "integration-new-api-key-delete-outside-a@example.com",
    });
    const secondSession = await env.auth.createSession({
      email: "integration-new-api-key-delete-outside-b@example.com",
    });
    await seedApiKey(env, {
      id: "apk_integration_delete_outside",
      organizationId: secondSession.organizationId,
      name: "Outside",
      secretPrefix: "prefix_integration_delete_outside",
      createdByActorId: secondSession.userId,
      createdAt: "2026-03-01T00:00:00.000Z",
      permissions: [OrganizationPermissions.ORGANIZATION_READ],
    });

    const response = await deleteApiKey({
      apiKeyId: "apk_integration_delete_outside",
      cookie: firstSession.cookie,
      env,
    });

    expect(response.status).toBe(404);
  });
});

async function createApiKey(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  name: string;
  permissions: string[];
}) {
  return await input.env.controlPlaneApi.http.fetch("/v1/api-keys", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: input.cookie,
    },
    body: JSON.stringify({
      name: input.name,
      permissions: input.permissions,
    }),
  });
}

async function listApiKeys(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  query: string;
}) {
  const response = await input.env.controlPlaneApi.http.fetch(`/v1/api-keys?${input.query}`, {
    headers: {
      cookie: input.cookie,
    },
  });

  expect(response.status).toBe(200);
  return ListApiKeysResponseSchema.parse(await response.json());
}

async function deleteApiKey(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  apiKeyId: string;
}) {
  return await input.env.controlPlaneApi.http.fetch(`/v1/api-keys/${input.apiKeyId}`, {
    method: "DELETE",
    headers: {
      cookie: input.cookie,
    },
  });
}

async function seedApiKey(
  env: IntegrationTestEnvironment,
  input: {
    id: string;
    organizationId: string;
    name: string;
    secretPrefix: string;
    createdByActorId: string;
    createdAt: string;
    revokedAt?: string | undefined;
    permissions: string[];
  },
) {
  await env.controlPlaneDb.insert(env.controlPlaneTables.apiKeys).values({
    id: input.id,
    organizationId: input.organizationId,
    name: input.name,
    secretPrefix: input.secretPrefix,
    secretHash: `hash_${input.id}`,
    secretHashAlgorithm: "sha256-v1",
    createdByActorKind: ApiKeyActorKinds.USER,
    createdByActorId: input.createdByActorId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    ...(input.revokedAt === undefined ? {} : { revokedAt: input.revokedAt }),
  });

  await env.controlPlaneDb.insert(env.controlPlaneTables.apiKeyPermissions).values(
    input.permissions.map((permission) => ({
      apiKeyId: input.id,
      permission,
    })),
  );
}
