/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationCredentialSecretKinds } from "@mistle/db/control-plane";
import { JiraConnectionMethodIds } from "@mistle/integrations-definitions";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  CreateFormConnectionBadRequestResponseSchema,
  CreateFormConnectionBodySchema,
} from "../src/integration-connections/create-form-connection/schema.js";
import {
  CreatedFormIntegrationConnectionSchema,
  IntegrationConnectionSchema,
} from "../src/integration-connections/schemas.js";
import {
  UpdateFormConnectionBadRequestResponseSchema,
  UpdateFormConnectionBodySchema,
} from "../src/integration-connections/update-form-connection/schema.js";
import {
  createFormConnection,
  expectCredentialSlots,
  readCredentialIds,
  seedIntegrationTarget,
  updateFormConnection,
} from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("Jira form integration connections", () => {
  it("creates a personal token connection", async ({ env }) => {
    await seedJiraTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-create-jira-personal@example.com",
    });

    const response = await createFormConnection({
      env,
      targetKey: "jira-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "Jira personal token",
        methodId: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
        config: {
          connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
          site_url: "https://mistle.atlassian.net",
          email: "user@example.com",
        },
        secrets: {
          apiKey: "jira-personal-token",
        },
      }),
    });

    expect(response.status).toBe(201);
    const connection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
    expect(connection.config).toEqual({
      connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
      site_url: "https://mistle.atlassian.net",
      email: "user@example.com",
    });

    await expectCredentialSlots({
      env,
      connectionId: connection.id,
      organizationId: session.organizationId,
      expected: [
        {
          slotKey: "jira.jira-default.jira-personal-api-token.api-key",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "jira-personal-token",
        },
      ],
    });
  });

  it("creates and rotates a service account token connection", async ({ env }) => {
    await seedJiraTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-update-jira-service@example.com",
    });
    const createResponse = await createFormConnection({
      env,
      targetKey: "jira-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "Jira service account token",
        methodId: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
        config: {
          connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
          cloud_id: "cloud-id-123",
        },
        secrets: {
          apiKey: "original-jira-service-token",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createResponse.json(),
    );
    expect(createdConnection.config).toEqual({
      connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
      cloud_id: "cloud-id-123",
    });
    const previousCredentialIds = await readCredentialIds({
      env,
      connectionId: createdConnection.id,
    });

    const updateResponse = await updateFormConnection({
      env,
      connectionId: createdConnection.id,
      cookie: session.cookie,
      body: UpdateFormConnectionBodySchema.parse({
        displayName: "Jira service account token rotated",
        config: {
          connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
          cloud_id: "cloud-id-456",
        },
        secrets: {
          apiKey: "rotated-jira-service-token",
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.displayName).toBe("Jira service account token rotated");
    expect(updatedConnection.config).toEqual({
      connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
      cloud_id: "cloud-id-456",
    });
    await expectCredentialSlots({
      env,
      connectionId: createdConnection.id,
      organizationId: session.organizationId,
      previousCredentialIds,
      expected: [
        {
          slotKey: "jira.jira-default.jira-service-account-api-token.api-key",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "rotated-jira-service-token",
        },
      ],
    });
  });

  it("creates and rotates a service account OAuth client credentials connection", async ({
    env,
  }) => {
    await seedJiraTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-update-jira-oauth@example.com",
    });
    const createResponse = await createFormConnection({
      env,
      targetKey: "jira-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "Jira service account OAuth client credentials",
        methodId: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
        config: {
          connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
          cloud_id: "cloud-id-123",
          client_id: "client-id-456",
        },
        secrets: {
          clientSecret: "original-jira-client-secret",
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
        displayName: "Jira service account OAuth client credentials rotated",
        config: {
          connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
          cloud_id: "cloud-id-456",
          client_id: "client-id-789",
        },
        secrets: {
          clientSecret: "rotated-jira-client-secret",
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.displayName).toBe(
      "Jira service account OAuth client credentials rotated",
    );
    expect(updatedConnection.config).toEqual({
      connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
      cloud_id: "cloud-id-456",
      client_id: "client-id-789",
    });
    await expectCredentialSlots({
      env,
      connectionId: createdConnection.id,
      organizationId: session.organizationId,
      previousCredentialIds,
      expected: [
        {
          slotKey: "jira.jira-default.jira-service-account-oauth-client-credentials.client-secret",
          secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
          plaintext: "rotated-jira-client-secret",
        },
      ],
    });
  });

  it("rejects method configs missing required Jira fields", async ({ env }) => {
    await seedJiraTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-jira-validation@example.com",
    });

    const missingSiteUrlResponse = await createFormConnection({
      env,
      targetKey: "jira-default",
      cookie: session.cookie,
      body: {
        displayName: "Jira personal token",
        methodId: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
        config: {
          connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
          email: "user@example.com",
        },
        secrets: {
          apiKey: "jira-personal-token",
        },
      },
    });
    expect(missingSiteUrlResponse.status).toBe(400);
    expect(
      CreateFormConnectionBadRequestResponseSchema.parse(await missingSiteUrlResponse.json()),
    ).toEqual({
      code: "INVALID_CREATE_CONNECTION_INPUT",
      message: `Connection config for method '${JiraConnectionMethodIds.PERSONAL_API_TOKEN}' is invalid.`,
    });

    const createResponse = await createFormConnection({
      env,
      targetKey: "jira-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "Jira service account token",
        methodId: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
        config: {
          connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
          cloud_id: "cloud-id-123",
        },
        secrets: {
          apiKey: "jira-service-account-token",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createResponse.json(),
    );

    const missingCloudIdResponse = await updateFormConnection({
      env,
      connectionId: createdConnection.id,
      cookie: session.cookie,
      body: {
        displayName: "Jira service account token rotated",
        config: {
          connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
        },
      },
    });
    expect(missingCloudIdResponse.status).toBe(400);
    expect(
      UpdateFormConnectionBadRequestResponseSchema.parse(await missingCloudIdResponse.json()),
    ).toEqual({
      code: "INVALID_UPDATE_CONNECTION_INPUT",
      message: `Connection config for method '${JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN}' is invalid.`,
    });
  });
});

async function seedJiraTarget(env: Parameters<typeof seedIntegrationTarget>[0]): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "jira-default",
    familyId: "jira",
    variantId: "jira-default",
    config: {},
  });
}
