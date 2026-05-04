/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationCredentialSecretKinds } from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { CreateFormConnectionBodySchema } from "../src/integration-connections/create-form-connection/schema.js";
import {
  CreatedFormIntegrationConnectionSchema,
  IntegrationConnectionSchema,
} from "../src/integration-connections/schemas.js";
import { UpdateFormConnectionBodySchema } from "../src/integration-connections/update-form-connection/schema.js";
import {
  createFormConnection,
  expectCredentialSlots,
  expectImplicitWebhookSource,
  readCredentialIds,
  seedIntegrationTarget,
  updateFormConnection,
} from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("GitHub form integration connections", () => {
  it("creates a GitHub App connection and implicit webhook source", async ({ env }) => {
    await seedGitHubTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-create-github@example.com",
    });

    const response = await createFormConnection({
      env,
      targetKey: "github-cloud",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "GitHub App installation",
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
      }),
    });

    expect(response.status).toBe(201);
    const connection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
    expect(connection.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      app_id: "123",
      app_slug: "mistle-github-app",
      client_id: "Iv1.client123",
    });
    expect(connection.targetSnapshotConfig).toEqual({
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    });

    await expectCredentialSlots({
      env,
      connectionId: connection.id,
      organizationId: session.organizationId,
      expected: [
        {
          slotKey: "github.github-cloud.github-app-installation.app-private-key-pem",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
        },
        {
          slotKey: "github.github-cloud.github-app-installation.client-secret",
          secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
          plaintext: "github-client-secret",
        },
        {
          slotKey: "github.github-cloud.github-app-installation.webhook-secret",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "github-webhook-secret",
        },
      ],
    });
    await expectImplicitWebhookSource({
      env,
      organizationId: session.organizationId,
      connectionId: connection.id,
      targetKey: "github-cloud",
    });
  });

  it("rotates all GitHub App credentials", async ({ env }) => {
    await seedGitHubTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-update-github@example.com",
    });
    const createResponse = await createFormConnection({
      env,
      targetKey: "github-cloud",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "GitHub App installation",
        methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        config: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "123",
          app_slug: "mistle-github-app",
          client_id: "Iv1.client123",
        },
        secrets: {
          appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\noriginal\n-----END PRIVATE KEY-----",
          clientSecret: "original-client-secret",
          webhookSecret: "original-webhook-secret",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createResponse.json(),
    );
    const previousCredentialIds = await readCredentialIds({
      env,
      connectionId: createdConnection.id,
    });

    const updateResponse = await updateFormConnection({
      env,
      connectionId: createdConnection.id,
      cookie: session.cookie,
      body: UpdateFormConnectionBodySchema.parse({
        displayName: "GitHub App installation updated",
        config: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "456",
          app_slug: "updated-github-app",
          client_id: "Iv1.client456",
        },
        secrets: {
          appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nupdated\n-----END PRIVATE KEY-----",
          clientSecret: "updated-client-secret",
          webhookSecret: "updated-webhook-secret",
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.displayName).toBe("GitHub App installation updated");
    expect(updatedConnection.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      app_id: "456",
      app_slug: "updated-github-app",
      client_id: "Iv1.client456",
    });

    await expectCredentialSlots({
      env,
      connectionId: createdConnection.id,
      organizationId: session.organizationId,
      previousCredentialIds,
      expected: [
        {
          slotKey: "github.github-cloud.github-app-installation.app-private-key-pem",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "-----BEGIN PRIVATE KEY-----\nupdated\n-----END PRIVATE KEY-----",
        },
        {
          slotKey: "github.github-cloud.github-app-installation.client-secret",
          secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
          plaintext: "updated-client-secret",
        },
        {
          slotKey: "github.github-cloud.github-app-installation.webhook-secret",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "updated-webhook-secret",
        },
      ],
    });
  });
});

async function seedGitHubTarget(env: Parameters<typeof seedIntegrationTarget>[0]): Promise<void> {
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
