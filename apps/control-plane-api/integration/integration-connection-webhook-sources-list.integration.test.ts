/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationConnectionStatuses } from "@mistle/db/control-plane";
import {
  IntegrationConnectionMethodIds,
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
} from "@mistle/integrations-core";
import { SentryConnectionMethodIds } from "@mistle/integrations-definitions";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { and, eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { ListIntegrationWebhookSourcesResponseSchema } from "../src/integration-connections/list-integration-webhook-sources/schema.js";
import { CreatedFormIntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import { createFormConnection, seedIntegrationTarget } from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration connection webhook sources list integration", () => {
  it("lists the implicit webhook source created with a GitHub App form connection", async ({
    env,
  }) => {
    const targetKey = "github-cloud-implicit-webhook-source";
    await seedGitHubTarget(env, targetKey);
    const session = await env.auth.createSession({
      email: "integration-new-webhook-sources-github-implicit@example.com",
    });

    const createdConnection = await createGitHubAppConnection(env, {
      cookie: session.cookie,
      targetKey,
    });

    const response = await listWebhookSources(env, {
      connectionId: createdConnection.id,
      cookie: session.cookie,
    });

    expect(response.status).toBe(200);
    const body = ListIntegrationWebhookSourcesResponseSchema.parse(await response.json());
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      targetKey,
      integrationConnectionId: createdConnection.id,
    });
    expect(body[0]?.callbackUrl).toContain(`/p/integration/webhooks/${targetKey}/`);
    expect(body[0]?.endpointKey.length).toBeGreaterThan(0);

    const persistedSource = await env.controlPlaneDb.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, session.organizationId),
          eq(table.targetKey, targetKey),
          eq(table.integrationConnectionId, createdConnection.id),
        ),
    });
    expect(persistedSource).toBeDefined();
  });

  it("persists trigger capabilities on the implicit source created with a Sentry webhook connection", async ({
    env,
  }) => {
    const targetKey = "sentry-default-implicit-webhook-source";
    await seedSentryTarget(env, targetKey);
    const session = await env.auth.createSession({
      email: "integration-new-webhook-sources-sentry-implicit@example.com",
    });

    const response = await createFormConnection({
      env,
      targetKey,
      cookie: session.cookie,
      body: {
        displayName: "Sentry webhook",
        methodId: SentryConnectionMethodIds.WEBHOOK_SIGNING_SECRET,
        config: {
          connection_method: SentryConnectionMethodIds.WEBHOOK_SIGNING_SECRET,
        },
        secrets: {
          clientSecret: "sentry-client-secret",
        },
      },
    });

    expect(response.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(await response.json());

    const listedResponse = await listWebhookSources(env, {
      connectionId: createdConnection.id,
      cookie: session.cookie,
    });
    expect(listedResponse.status).toBe(200);
    const listedSources = ListIntegrationWebhookSourcesResponseSchema.parse(
      await listedResponse.json(),
    );
    expect(listedSources).toHaveLength(1);
    expect(listedSources[0]?.providerMetadata).toEqual({
      [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
        events: ["issue"],
      },
    });

    const persistedSource = await env.controlPlaneDb.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, session.organizationId),
          eq(table.targetKey, targetKey),
          eq(table.integrationConnectionId, createdConnection.id),
        ),
    });
    if (persistedSource === undefined) {
      throw new Error(`Expected implicit webhook source for '${createdConnection.id}'.`);
    }
    expect(persistedSource.providerMetadata).toEqual({
      [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
        events: ["issue"],
      },
    });
  });

  it("does not expose webhook sources for GitHub API-key connections", async ({ env }) => {
    const targetKey = "github-cloud-api-key-no-webhooks";
    await seedGitHubTarget(env, targetKey);
    const session = await env.auth.createSession({
      email: "integration-new-webhook-sources-github-api-key@example.com",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
      id: "icn_integration_new_github_api_key_no_webhooks",
      organizationId: session.organizationId,
      targetKey,
      displayName: "GitHub API key",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      targetSnapshotConfig: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    });

    const response = await listWebhookSources(env, {
      connectionId: "icn_integration_new_github_api_key_no_webhooks",
      cookie: session.cookie,
    });

    expect(response.status).toBe(200);
    expect(ListIntegrationWebhookSourcesResponseSchema.parse(await response.json())).toEqual([]);
    expect(
      await env.controlPlaneDb.query.integrationWebhookSources.findFirst({
        where: (table, { eq }) =>
          eq(table.integrationConnectionId, "icn_integration_new_github_api_key_no_webhooks"),
      }),
    ).toBeUndefined();
  });

  it("returns 403 after the active organization membership is revoked", async ({ env }) => {
    const targetKey = "github-cloud-revoked-webhook-source-list";
    await seedGitHubTarget(env, targetKey);
    const session = await env.auth.createSession({
      email: "integration-new-webhook-sources-revoked-membership@example.com",
    });
    const createdConnection = await createGitHubAppConnection(env, {
      cookie: session.cookie,
      targetKey,
    });

    await env.controlPlaneDb
      .delete(env.controlPlaneTables.members)
      .where(
        and(
          eq(env.controlPlaneTables.members.organizationId, session.organizationId),
          eq(env.controlPlaneTables.members.userId, session.userId),
        ),
      );

    const response = await listWebhookSources(env, {
      connectionId: createdConnection.id,
      cookie: session.cookie,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });
});

async function createGitHubAppConnection(
  env: IntegrationTestEnvironment,
  input: {
    cookie: string;
    targetKey: string;
  },
) {
  const response = await createFormConnection({
    env,
    targetKey: input.targetKey,
    cookie: input.cookie,
    body: {
      displayName: "GitHub App Installation",
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
      },
      secrets: {
        appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
        clientSecret: "github-client-secret",
        webhookSecret: "github-webhook-secret",
      },
    },
  });
  expect(response.status).toBe(201);
  return CreatedFormIntegrationConnectionSchema.parse(await response.json());
}

async function listWebhookSources(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    cookie: string;
  },
) {
  return env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/webhook-sources`,
    {
      method: "GET",
      headers: {
        cookie: input.cookie,
      },
    },
  );
}

async function seedGitHubTarget(env: IntegrationTestEnvironment, targetKey: string): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey,
    familyId: "github",
    variantId: "github-cloud",
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
}

async function seedSentryTarget(env: IntegrationTestEnvironment, targetKey: string): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey,
    familyId: "sentry",
    variantId: "sentry-default",
    config: {},
  });
}
