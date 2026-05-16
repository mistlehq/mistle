/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { CreateApiKeyResponseSchema } from "../src/api-keys/create-api-key/schema.js";
import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import { CurrentActorResponseSchema } from "../src/me/get-current-actor/schema.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("current actor integration", () => {
  it("returns the current user context for session-authenticated requests", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-current-actor-session@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = CurrentActorResponseSchema.parse(await response.json());
    expect(body.authentication).toStrictEqual({
      kind: "session",
    });
    expect(body.actor).toStrictEqual({
      kind: "user",
      id: session.userId,
    });
    expect(body.organization).toStrictEqual({
      id: session.organizationId,
    });
    expect(body.permissions).toContain(OrganizationPermissions.ORGANIZATION_READ);
  });

  it("returns the current API key context for bearer-authenticated requests", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-current-actor-api-key@example.com",
    });
    const createdApiKey = await createApiKey({
      cookie: session.cookie,
      env,
      name: "CLI current actor",
      permissions: [
        OrganizationPermissions.ORGANIZATION_READ,
        OrganizationPermissions.SANDBOX_SESSION_CREATE,
      ],
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me", {
      headers: {
        authorization: `Bearer ${createdApiKey.token}`,
      },
    });

    expect(response.status).toBe(200);
    const body = CurrentActorResponseSchema.parse(await response.json());
    expect(body).toStrictEqual({
      authentication: {
        kind: "api_key",
        apiKey: {
          id: createdApiKey.apiKey.id,
          name: "CLI current actor",
        },
      },
      actor: {
        kind: "api_key",
        id: createdApiKey.apiKey.id,
        name: "CLI current actor",
      },
      organization: {
        id: session.organizationId,
      },
      permissions: [
        OrganizationPermissions.ORGANIZATION_READ,
        OrganizationPermissions.SANDBOX_SESSION_CREATE,
      ],
    });

    const persistedApiKey = await env.controlPlaneDb.query.apiKeys.findFirst({
      where: (table, { eq }) => eq(table.id, createdApiKey.apiKey.id),
    });
    expect(persistedApiKey?.lastUsedAt).not.toBeNull();
  });

  it("rejects invalid bearer tokens", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/v1/me", {
      headers: {
        authorization: "Bearer mstl_apk_missing_missing",
      },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });

  it("rejects malformed bearer headers instead of falling back to session auth", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-current-actor-malformed-bearer@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me", {
      headers: {
        authorization: "Bearer",
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });
});

async function createApiKey(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  name: string;
  permissions: string[];
}) {
  const response = await input.env.controlPlaneApi.http.fetch("/v1/api-keys", {
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

  expect(response.status).toBe(201);
  return CreateApiKeyResponseSchema.parse(await response.json());
}
