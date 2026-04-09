import {
  integrationConnections,
  IntegrationCredentialSecretKinds,
  integrationTargets,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  JiraConnectionMethodIds,
  SlackConnectionMethodIds,
} from "@mistle/integrations-definitions";
import { describe, expect } from "vitest";

import { CreateFormConnectionBodySchema } from "../src/integration-connections/create-form-connection/schema.js";
import { IntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import {
  UpdateFormConnectionBadRequestResponseSchema,
  UpdateFormConnectionBodySchema,
  UpdateFormConnectionNotFoundResponseSchema,
} from "../src/integration-connections/update-form-connection/schema.js";
import {
  decryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/lib/crypto.js";
import { it } from "./test-context.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";

describe("integration connections update form integration", () => {
  it("updates an existing form connection credential for the same connection id", async ({
    fixture,
  }) => {
    await upsertOpenAiTarget({ fixture, targetKey: "openai-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-form@example.com",
    });

    const createBody = CreateFormConnectionBodySchema.parse({
      displayName: "OpenAI primary",
      methodId: IntegrationConnectionMethodIds.API_KEY,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      secrets: {
        apiKey: "sk-test-original-api-key",
      },
    });

    const createResponse = await fixture.request(
      "/v1/integration/connections/openai-default/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify(createBody),
      },
    );

    expect(createResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const previousLink = await fixture.db.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.connectionId, createdConnection.id),
          eq(table.slotKey, "openai.openai-default.api-key.api-key"),
        ),
    });
    expect(previousLink).toBeDefined();

    if (previousLink === undefined) {
      throw new Error("Expected an existing form credential link.");
    }

    const updateBody = UpdateFormConnectionBodySchema.parse({
      displayName: "OpenAI rotated",
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      secrets: {
        apiKey: "sk-test-rotated-api-key",
      },
    });

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify(updateBody),
      },
    );

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.id).toBe(createdConnection.id);
    expect(updatedConnection.targetKey).toBe(createdConnection.targetKey);
    expect(updatedConnection.displayName).toBe("OpenAI rotated");
    expect(updatedConnection.status).toBe("active");

    const updatedLink = await fixture.db.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.connectionId, createdConnection.id),
          eq(table.slotKey, "openai.openai-default.api-key.api-key"),
        ),
    });
    expect(updatedLink).toBeDefined();

    if (updatedLink === undefined) {
      throw new Error("Expected updated form credential link.");
    }

    expect(updatedLink.credentialId).not.toBe(previousLink.credentialId);

    const updatedCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, updatedLink.credentialId),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(updatedCredential).toBeDefined();

    if (updatedCredential === undefined) {
      throw new Error("Expected updated integration credential.");
    }

    expect(updatedCredential.secretKind).toBe(IntegrationCredentialSecretKinds.API_KEY);
    expect(updatedCredential.intendedFamilyId).toBe("openai");

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.version, updatedCredential.organizationCredentialKeyVersion),
        ),
    });
    expect(organizationCredentialKey).toBeDefined();

    if (organizationCredentialKey === undefined) {
      throw new Error("Expected organization credential key.");
    }

    const decryptedApiKey = decryptStoredApiKey({
      wrappedOrganizationKeyCiphertext: organizationCredentialKey.ciphertext,
      masterKeyVersion: organizationCredentialKey.masterKeyVersion,
      masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
      nonce: updatedCredential.nonce,
      ciphertext: updatedCredential.ciphertext,
    });

    expect(decryptedApiKey).toBe("sk-test-rotated-api-key");
  });

  it("returns 404 when the connection does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-form-missing@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/icn_missing/form", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify(
        UpdateFormConnectionBodySchema.parse({
          displayName: "Missing connection",
          config: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
          secrets: {
            apiKey: "sk-test-rotated-api-key",
          },
        }),
      ),
    });

    expect(response.status).toBe(404);
    const responseBody = UpdateFormConnectionNotFoundResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      code: "CONNECTION_NOT_FOUND",
      message: "Integration connection 'icn_missing' was not found.",
    });
  });

  it("returns 400 when the connection is not a form connection", async ({ fixture }) => {
    await upsertOpenAiTarget({ fixture, targetKey: "openai-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-form-non-form@example.com",
    });

    const [createdConnection] = await fixture.db
      .insert(integrationConnections)
      .values({
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-default",
        displayName: "Redirect-only connection",
        status: "active",
        config: {},
        targetSnapshotConfig: {
          api_base_url: "https://api.openai.com",
        },
      })
      .returning({
        id: integrationConnections.id,
      });

    if (createdConnection === undefined) {
      throw new Error("Expected integration connection.");
    }

    const response = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Redirect-only connection",
          config: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
          secrets: {
            apiKey: "sk-test-rotated-api-key",
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = UpdateFormConnectionBadRequestResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      code: "FORM_CONNECTION_REQUIRED",
      message: `Integration connection '${createdConnection.id}' is not a form connection.`,
    });
  });

  it("keeps the existing credential when secret is omitted", async ({ fixture }) => {
    await upsertOpenAiTarget({ fixture, targetKey: "openai-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-form-name-only@example.com",
    });

    const createResponse = await fixture.request(
      "/v1/integration/connections/openai-default/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "OpenAI primary",
          methodId: IntegrationConnectionMethodIds.API_KEY,
          config: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
          secrets: {
            apiKey: "sk-test-original-api-key",
          },
        }),
      },
    );

    expect(createResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const previousLink = await fixture.db.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.connectionId, createdConnection.id),
          eq(table.slotKey, "openai.openai-default.api-key.api-key"),
        ),
    });
    expect(previousLink).toBeDefined();

    if (previousLink === undefined) {
      throw new Error("Expected existing credential link.");
    }

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "OpenAI renamed",
          config: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
        }),
      },
    );

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.displayName).toBe("OpenAI renamed");

    const updatedLink = await fixture.db.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.connectionId, createdConnection.id),
          eq(table.slotKey, "openai.openai-default.api-key.api-key"),
        ),
    });
    expect(updatedLink).toBeDefined();

    if (updatedLink === undefined) {
      throw new Error("Expected credential link to remain.");
    }

    expect(updatedLink.credentialId).toBe(previousLink.credentialId);
  });

  it("returns 400 when secret is provided as only whitespace", async ({ fixture }) => {
    await upsertOpenAiTarget({ fixture, targetKey: "openai-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-form-whitespace-secret@example.com",
    });

    const createResponse = await fixture.request(
      "/v1/integration/connections/openai-default/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "OpenAI primary",
          methodId: IntegrationConnectionMethodIds.API_KEY,
          config: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
          secrets: {
            apiKey: "sk-test-original-api-key",
          },
        }),
      },
    );

    expect(createResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "OpenAI renamed",
          config: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
          secrets: {
            apiKey: "   ",
          },
        }),
      },
    );

    expect(updateResponse.status).toBe(400);
    const responseBody = UpdateFormConnectionBadRequestResponseSchema.parse(
      await updateResponse.json(),
    );
    expect(responseBody).toEqual({
      code: "INVALID_UPDATE_CONNECTION_INPUT",
      message: `Secret field 'API key' must contain at least one non-whitespace character when provided.`,
    });
  });

  it("updates Jira service account token connections", async ({ fixture }) => {
    await upsertJiraTarget({ fixture, targetKey: "jira-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-jira-service@example.com",
    });

    const createResponse = await fixture.request("/v1/integration/connections/jira-default/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
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
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Jira service account token rotated",
          config: {
            connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
            cloud_id: "cloud-id-456",
          },
          secrets: {
            apiKey: "rotated-jira-service-token",
          },
        }),
      },
    );

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.displayName).toBe("Jira service account token rotated");
    expect(updatedConnection.config).toEqual({
      connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
      cloud_id: "cloud-id-456",
    });
  });

  it("returns 400 when Jira personal token updates omit site_url", async ({ fixture }) => {
    await upsertJiraTarget({ fixture, targetKey: "jira-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-jira-personal-missing-site-url@example.com",
    });

    const createResponse = await fixture.request("/v1/integration/connections/jira-default/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
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

    expect(createResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Jira personal token updated",
          config: {
            connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
            email: "user@example.com",
          },
        }),
      },
    );

    expect(updateResponse.status).toBe(400);
    const responseBody = UpdateFormConnectionBadRequestResponseSchema.parse(
      await updateResponse.json(),
    );
    expect(responseBody).toEqual({
      code: "INVALID_UPDATE_CONNECTION_INPUT",
      message: `Connection config for method '${JiraConnectionMethodIds.PERSONAL_API_TOKEN}' is invalid.`,
    });
  });

  it("updates Jira service account OAuth client credentials connections", async ({ fixture }) => {
    await upsertJiraTarget({ fixture, targetKey: "jira-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-jira-service-oauth@example.com",
    });

    const createResponse = await fixture.request("/v1/integration/connections/jira-default/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
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
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
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
      },
    );

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

    const updatedLink = await fixture.db.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.connectionId, createdConnection.id),
          eq(
            table.slotKey,
            "jira.jira-default.jira-service-account-oauth-client-credentials.client-secret",
          ),
        ),
    });
    expect(updatedLink).toBeDefined();

    if (updatedLink === undefined) {
      throw new Error("Expected updated form credential link.");
    }

    const updatedCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, updatedLink.credentialId),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(updatedCredential).toBeDefined();

    if (updatedCredential === undefined) {
      throw new Error("Expected updated integration credential.");
    }

    expect(updatedCredential.secretKind).toBe(
      IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
    );

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.version, updatedCredential.organizationCredentialKeyVersion),
        ),
    });
    expect(organizationCredentialKey).toBeDefined();

    if (organizationCredentialKey === undefined) {
      throw new Error("Expected organization credential key.");
    }

    const decryptedClientSecret = decryptStoredApiKey({
      wrappedOrganizationKeyCiphertext: organizationCredentialKey.ciphertext,
      masterKeyVersion: organizationCredentialKey.masterKeyVersion,
      masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
      nonce: updatedCredential.nonce,
      ciphertext: updatedCredential.ciphertext,
    });

    expect(decryptedClientSecret).toBe("rotated-jira-client-secret");
  });

  it("returns 400 when Jira service account token updates omit cloud_id", async ({ fixture }) => {
    await upsertJiraTarget({ fixture, targetKey: "jira-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-jira-service-missing-cloud-id@example.com",
    });

    const createResponse = await fixture.request("/v1/integration/connections/jira-default/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
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
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Jira service account token rotated",
          config: {
            connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
          },
        }),
      },
    );

    expect(updateResponse.status).toBe(400);
    const responseBody = UpdateFormConnectionBadRequestResponseSchema.parse(
      await updateResponse.json(),
    );
    expect(responseBody).toEqual({
      code: "INVALID_UPDATE_CONNECTION_INPUT",
      message: `Connection config for method '${JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN}' is invalid.`,
    });
  });

  it("updates Slack bot token connections", async ({ fixture }) => {
    await upsertSlackTarget({ fixture, targetKey: "slack-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-slack-bot-token@example.com",
    });

    const createResponse = await fixture.request("/v1/integration/connections/slack-default/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "Slack bot token",
        methodId: SlackConnectionMethodIds.SLACK_BOT_TOKEN,
        config: {
          connection_method: SlackConnectionMethodIds.SLACK_BOT_TOKEN,
        },
        secrets: {
          botToken: "xoxb-original-bot-token",
          signingSecret: "original-signing-secret",
        },
      }),
    });

    expect(createResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const previousLinks = await fixture.db.query.integrationConnectionCredentials.findMany({
      where: (table, { eq }) => eq(table.connectionId, createdConnection.id),
      orderBy: (table, { asc }) => [asc(table.slotKey)],
    });
    expect(previousLinks).toHaveLength(2);

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Slack bot token rotated",
          config: {
            connection_method: SlackConnectionMethodIds.SLACK_BOT_TOKEN,
          },
          secrets: {
            botToken: "xoxb-rotated-bot-token",
            signingSecret: "rotated-signing-secret",
          },
        }),
      },
    );

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.displayName).toBe("Slack bot token rotated");
    expect(updatedConnection.config).toEqual({
      connection_method: SlackConnectionMethodIds.SLACK_BOT_TOKEN,
    });

    const updatedLinks = await fixture.db.query.integrationConnectionCredentials.findMany({
      where: (table, { eq }) => eq(table.connectionId, createdConnection.id),
      orderBy: (table, { asc }) => [asc(table.slotKey)],
    });

    expect(updatedLinks).toHaveLength(2);
    expect(updatedLinks.map((link) => link.slotKey)).toEqual([
      "slack.slack-default.slack-bot-token.bot-token",
      "slack.slack-default.slack-bot-token.signing-secret",
    ]);
    expect(updatedLinks[0]?.credentialId).not.toBe(previousLinks[0]?.credentialId);
    expect(updatedLinks[1]?.credentialId).not.toBe(previousLinks[1]?.credentialId);

    const updatedCredentials = await fixture.db.query.integrationCredentials.findMany({
      where: (table, { and, eq, inArray }) =>
        and(
          inArray(
            table.id,
            updatedLinks.map((link) => link.credentialId),
          ),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
      orderBy: (table, { asc }) => [asc(table.id)],
    });

    expect(updatedCredentials).toHaveLength(2);
    expect(updatedCredentials.map((credential) => credential.secretKind)).toEqual([
      IntegrationCredentialSecretKinds.API_KEY,
      IntegrationCredentialSecretKinds.API_KEY,
    ]);
  });

  it("updates GitHub App form connections", async ({ fixture }) => {
    await upsertGitHubTarget({ fixture, targetKey: "github-cloud" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-github-app@example.com",
    });

    const createResponse = await fixture.request("/v1/integration/connections/github-cloud/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "GitHub App installation",
        methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        config: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "123",
          app_slug: "mistle-github-app",
        },
        secrets: {
          appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\noriginal\n-----END PRIVATE KEY-----",
          webhookSecret: "original-webhook-secret",
        },
      }),
    });

    expect(createResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const previousLinks = await fixture.db.query.integrationConnectionCredentials.findMany({
      where: (table, { eq }) => eq(table.connectionId, createdConnection.id),
      orderBy: (table, { asc }) => [asc(table.slotKey)],
    });
    expect(previousLinks).toHaveLength(2);

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "GitHub App installation updated",
          config: {
            connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
            app_id: "456",
            app_slug: "updated-github-app",
          },
          secrets: {
            appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nupdated\n-----END PRIVATE KEY-----",
            webhookSecret: "updated-webhook-secret",
          },
        }),
      },
    );

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.displayName).toBe("GitHub App installation updated");
    expect(updatedConnection.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      app_id: "456",
      app_slug: "updated-github-app",
    });

    const updatedLinks = await fixture.db.query.integrationConnectionCredentials.findMany({
      where: (table, { eq }) => eq(table.connectionId, createdConnection.id),
      orderBy: (table, { asc }) => [asc(table.slotKey)],
    });

    expect(updatedLinks).toHaveLength(2);
    expect(updatedLinks.map((link) => link.slotKey)).toEqual([
      "github.github-cloud.github-app-installation.app-private-key-pem",
      "github.github-cloud.github-app-installation.webhook-secret",
    ]);
    expect(updatedLinks[0]?.credentialId).not.toBe(previousLinks[0]?.credentialId);
    expect(updatedLinks[1]?.credentialId).not.toBe(previousLinks[1]?.credentialId);

    const updatedCredentials = await fixture.db.query.integrationCredentials.findMany({
      where: (table, { and, eq, inArray }) =>
        and(
          inArray(
            table.id,
            updatedLinks.map((link) => link.credentialId),
          ),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
      orderBy: (table, { asc }) => [asc(table.id)],
    });

    expect(updatedCredentials).toHaveLength(2);
    expect(updatedCredentials.map((credential) => credential.secretKind)).toEqual([
      IntegrationCredentialSecretKinds.API_KEY,
      IntegrationCredentialSecretKinds.API_KEY,
    ]);
  });
});

async function upsertOpenAiTarget(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
}) {
  await input.fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com",
      },
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com",
        },
      },
    });
}

async function upsertJiraTarget(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
}) {
  await input.fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "jira",
      variantId: "jira-default",
      enabled: true,
      config: {},
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "jira",
        variantId: "jira-default",
        enabled: true,
        config: {},
      },
    });
}

async function upsertSlackTarget(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
}) {
  await input.fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "slack",
      variantId: "slack-default",
      enabled: true,
      config: {
        api_base_url: "https://slack.com/api",
      },
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          api_base_url: "https://slack.com/api",
        },
      },
    });
}

async function upsertGitHubTarget(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
}) {
  await input.fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      },
    });
}

function decryptStoredApiKey(input: {
  wrappedOrganizationKeyCiphertext: string;
  masterKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
  nonce: string;
  ciphertext: string;
}): string {
  const masterKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: input.masterKeyVersion,
    masterEncryptionKeys: input.masterEncryptionKeys,
  });
  const organizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: input.wrappedOrganizationKeyCiphertext,
    masterEncryptionKeyMaterial: masterKeyMaterial,
  });

  try {
    return decryptCredentialUtf8({
      nonce: input.nonce,
      ciphertext: input.ciphertext,
      organizationCredentialKey,
    });
  } finally {
    organizationCredentialKey.fill(0);
  }
}
