/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { CreateDraftFormConnectionBodySchema } from "../src/integration-connections/create-draft-form-connection/schema.js";
import { ListIntegrationConnectionsResponseSchema } from "../src/integration-connections/list-integration-connections/schema.js";
import {
  CreatedFormIntegrationConnectionSchema,
  IntegrationConnectionSchema,
} from "../src/integration-connections/schemas.js";
import { createFormConnection, seedIntegrationTarget } from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("GitHub App draft integration connections", () => {
  it("creates a draft connection before app credentials are provided", async ({ env }) => {
    await seedGitHubCloudTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-github-app-installation-draft@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/integration/connections/github-cloud/github-app-installation/draft",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify(
          CreateDraftFormConnectionBodySchema.parse({
            displayName: "Draft GitHub",
          }),
        ),
      },
    );

    expect(response.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await response.json());
    expect(createdConnection.displayName).toBe("Draft GitHub");
    expect(createdConnection.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    });
    expect(createdConnection.configuredSecretNames).toBeUndefined();

    const persistedWebhookSource =
      await env.controlPlaneDb.query.integrationWebhookSources.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, session.organizationId),
            eq(table.integrationConnectionId, createdConnection.id),
          ),
      });
    expect(persistedWebhookSource).toBeDefined();
  });

  it("returns configured secret names for completed GitHub App connections in the list response", async ({
    env,
  }) => {
    await seedGitHubCloudTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-github-app-installation-configured-secrets@example.com",
    });
    const connectionId = await createGitHubAppConnection(env, {
      cookie: session.cookie,
      displayName: "GitHub Prod",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/integration/connections?limit=20", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const payload = ListIntegrationConnectionsResponseSchema.parse(await response.json());
    const listedConnection = payload.items.find((item) => item.id === connectionId);
    expect(listedConnection?.configuredSecretNames).toEqual([
      "appPrivateKeyPem",
      "clientSecret",
      "webhookSecret",
    ]);
  });
});

async function seedGitHubCloudTarget(env: IntegrationTestEnvironment): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "github-cloud",
    familyId: "github",
    variantId: "github-cloud",
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
}

async function createGitHubAppConnection(
  env: IntegrationTestEnvironment,
  input: {
    cookie: string;
    displayName: string;
  },
): Promise<string> {
  const response = await createFormConnection({
    env,
    targetKey: "github-cloud",
    cookie: input.cookie,
    body: {
      displayName: input.displayName,
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
  const createdConnection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
  return createdConnection.id;
}
