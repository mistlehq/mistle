import {
  integrationConnectionCredentials,
  integrationConnections,
  integrationCredentials,
  IntegrationCredentialSecretKinds,
  integrationTargets,
} from "@mistle/db/control-plane";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  DatadogCredentialSlotKeys,
  JiraConnectionMethodIds,
  SlackConnectionMethodIds,
} from "@mistle/integrations-definitions";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import {
  CreateFormConnectionBadRequestResponseSchema,
  CreateFormConnectionBodySchema,
  CreateFormConnectionNotFoundResponseSchema,
} from "../src/integration-connections/create-form-connection/schema.js";
import { IntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import {
  decryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/lib/crypto.js";
import { it } from "./test-context.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";

describe("integration connections create form integration", () => {
  it("creates connection + encrypted credential + link for an enabled target", async ({
    fixture,
  }) => {
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default",
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

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-form@example.com",
    });

    const requestBody = CreateFormConnectionBodySchema.parse({
      displayName: "Primary OpenAI key",
      methodId: IntegrationConnectionMethodIds.API_KEY,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      secrets: {
        apiKey: "sk-test-connection-api-key",
      },
    });

    const response = await fixture.request("/v1/integration/connections/openai-default/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(201);
    const responseBody = IntegrationConnectionSchema.parse(await response.json());

    expect(responseBody.targetKey).toBe("openai-default");
    expect(responseBody.displayName).toBe("Primary OpenAI key");
    expect(responseBody.status).toBe("active");
    expect(responseBody.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    });
    expect(responseBody.targetSnapshotConfig).toEqual({
      api_base_url: "https://api.openai.com",
    });

    const createdConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, responseBody.id),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(createdConnection).toBeDefined();

    if (createdConnection === undefined) {
      throw new Error("Expected created integration connection.");
    }
    expect(createdConnection.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    });
    expect(createdConnection.displayName).toBe("Primary OpenAI key");

    const createdConnectionCredential =
      await fixture.db.query.integrationConnectionCredentials.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, createdConnection.id),
            eq(table.slotKey, "openai.openai-default.api-key.api-key"),
          ),
      });
    expect(createdConnectionCredential).toBeDefined();

    if (createdConnectionCredential === undefined) {
      throw new Error("Expected integration connection credential link.");
    }

    const createdCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, createdConnectionCredential.credentialId),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(createdCredential).toBeDefined();

    if (createdCredential === undefined) {
      throw new Error("Expected integration credential.");
    }

    expect(createdCredential.secretKind).toBe(IntegrationCredentialSecretKinds.API_KEY);
    expect(createdCredential.intendedFamilyId).toBe("openai");
    expect(createdCredential.ciphertext).not.toContain(requestBody.secrets.apiKey);

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.version, createdCredential.organizationCredentialKeyVersion),
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
      nonce: createdCredential.nonce,
      ciphertext: createdCredential.ciphertext,
    });

    expect(decryptedApiKey).toBe(requestBody.secrets.apiKey);
  });

  it("creates AWS assume-role connections", async ({ fixture }) => {
    await upsertAwsTarget({ fixture, targetKey: "aws-cli-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-aws-assume-role@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/aws-cli-default/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "AWS assume role",
        methodId: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
        config: {
          connection_method: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAEXAMPLE",
          roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
          externalId: "mistle-external-id",
          durationSeconds: 3600,
        },
        secrets: {
          secretAccessKey: "aws-secret-access-key-value",
        },
      }),
    });

    expect(response.status).toBe(201);
    const responseBody = IntegrationConnectionSchema.parse(await response.json());
    expect(responseBody.targetKey).toBe("aws-cli-default");
    expect(responseBody.displayName).toBe("AWS assume role");
    expect(responseBody.status).toBe("active");
    expect(responseBody.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
      accessKeyId: "AKIAEXAMPLE",
      roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
      externalId: "mistle-external-id",
      durationSeconds: 3600,
    });
    expect(responseBody.targetSnapshotConfig).toEqual({});

    const createdLink = await fixture.db.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.connectionId, responseBody.id),
          eq(table.slotKey, "aws.aws-cli-default.aws-assume-role.secret-access-key"),
        ),
    });
    expect(createdLink).toBeDefined();

    if (createdLink === undefined) {
      throw new Error("Expected AWS integration connection credential link.");
    }

    const createdCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, createdLink.credentialId),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(createdCredential).toBeDefined();

    if (createdCredential === undefined) {
      throw new Error("Expected AWS integration credential.");
    }

    expect(createdCredential.secretKind).toBe(
      IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY,
    );
    expect(createdCredential.intendedFamilyId).toBe("aws");

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.version, createdCredential.organizationCredentialKeyVersion),
        ),
    });
    expect(organizationCredentialKey).toBeDefined();

    if (organizationCredentialKey === undefined) {
      throw new Error("Expected organization credential key.");
    }

    const decryptedSecretAccessKey = decryptStoredApiKey({
      wrappedOrganizationKeyCiphertext: organizationCredentialKey.ciphertext,
      masterKeyVersion: organizationCredentialKey.masterKeyVersion,
      masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
      nonce: createdCredential.nonce,
      ciphertext: createdCredential.ciphertext,
    });

    expect(decryptedSecretAccessKey).toBe("aws-secret-access-key-value");
  });

  it("returns 404 when target does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-form-missing-target@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/missing_target/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "Missing target",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-test-missing-target",
        },
      }),
    });

    expect(response.status).toBe(404);
    const responseBody = CreateFormConnectionNotFoundResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      code: "TARGET_NOT_FOUND",
      message: "Integration target 'missing_target' was not found.",
    });
  });

  it("creates Jira personal token connections", async ({ fixture }) => {
    await upsertJiraTarget({ fixture, targetKey: "jira-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-jira-personal@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/jira-default/form", {
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

    expect(response.status).toBe(201);
    const responseBody = IntegrationConnectionSchema.parse(await response.json());
    expect(responseBody.config).toEqual({
      connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
      site_url: "https://mistle.atlassian.net",
      email: "user@example.com",
    });

    const createdConnectionCredential =
      await fixture.db.query.integrationConnectionCredentials.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, responseBody.id),
            eq(table.slotKey, "jira.jira-default.jira-personal-api-token.api-key"),
          ),
      });
    expect(createdConnectionCredential).toBeDefined();

    if (createdConnectionCredential === undefined) {
      throw new Error("Expected integration connection credential link.");
    }

    const createdCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, createdConnectionCredential.credentialId),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(createdCredential).toBeDefined();

    if (createdCredential === undefined) {
      throw new Error("Expected integration credential.");
    }

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.version, createdCredential.organizationCredentialKeyVersion),
        ),
    });
    expect(organizationCredentialKey).toBeDefined();

    if (organizationCredentialKey === undefined) {
      throw new Error("Expected organization credential key.");
    }

    expect(
      decryptStoredApiKey({
        wrappedOrganizationKeyCiphertext: organizationCredentialKey.ciphertext,
        masterKeyVersion: organizationCredentialKey.masterKeyVersion,
        masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
        nonce: createdCredential.nonce,
        ciphertext: createdCredential.ciphertext,
      }),
    ).toBe("jira-personal-token");
  });

  it("creates Jira service account token connections", async ({ fixture }) => {
    await upsertJiraTarget({ fixture, targetKey: "jira-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-jira-service@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/jira-default/form", {
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

    expect(response.status).toBe(201);
    const responseBody = IntegrationConnectionSchema.parse(await response.json());
    expect(responseBody.config).toEqual({
      connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
      cloud_id: "cloud-id-123",
    });
    expect(responseBody.targetSnapshotConfig).toEqual({});
  });

  it("creates Jira service account OAuth client credentials connections", async ({ fixture }) => {
    await upsertJiraTarget({ fixture, targetKey: "jira-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-jira-service-oauth@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/jira-default/form", {
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
          clientSecret: "jira-client-secret",
        },
      }),
    });

    expect(response.status).toBe(201);
    const responseBody = IntegrationConnectionSchema.parse(await response.json());
    expect(responseBody.config).toEqual({
      connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
      cloud_id: "cloud-id-123",
      client_id: "client-id-456",
    });

    const createdConnectionCredential =
      await fixture.db.query.integrationConnectionCredentials.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, responseBody.id),
            eq(
              table.slotKey,
              "jira.jira-default.jira-service-account-oauth-client-credentials.client-secret",
            ),
          ),
      });
    expect(createdConnectionCredential).toBeDefined();

    if (createdConnectionCredential === undefined) {
      throw new Error("Expected integration connection credential link.");
    }

    const createdCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, createdConnectionCredential.credentialId),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(createdCredential).toBeDefined();

    if (createdCredential === undefined) {
      throw new Error("Expected integration credential.");
    }

    expect(createdCredential.secretKind).toBe(
      IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
    );

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.version, createdCredential.organizationCredentialKeyVersion),
        ),
    });
    expect(organizationCredentialKey).toBeDefined();

    if (organizationCredentialKey === undefined) {
      throw new Error("Expected organization credential key.");
    }

    expect(
      decryptStoredApiKey({
        wrappedOrganizationKeyCiphertext: organizationCredentialKey.ciphertext,
        masterKeyVersion: organizationCredentialKey.masterKeyVersion,
        masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
        nonce: createdCredential.nonce,
        ciphertext: createdCredential.ciphertext,
      }),
    ).toBe("jira-client-secret");
  });

  it("creates Slack bot token connections and the implicit webhook source", async ({ fixture }) => {
    await upsertSlackTarget({ fixture, targetKey: "slack-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-slack-bot-token@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/slack-default/form", {
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
          botToken: "xoxb-test-bot-token",
          signingSecret: "slack-signing-secret",
        },
      }),
    });

    expect(response.status).toBe(201);
    const responseBody = IntegrationConnectionSchema.parse(await response.json());
    expect(responseBody.config).toEqual({
      connection_method: SlackConnectionMethodIds.SLACK_BOT_TOKEN,
    });
    expect(responseBody.targetSnapshotConfig).toEqual({
      api_base_url: "https://slack.com/api",
    });

    const createdLinks = await fixture.db.query.integrationConnectionCredentials.findMany({
      where: (table, { eq }) => eq(table.connectionId, responseBody.id),
      orderBy: (table, { asc }) => [asc(table.slotKey)],
    });

    expect(createdLinks.map((link) => link.slotKey)).toEqual([
      "slack.slack-default.slack-bot-token.bot-token",
      "slack.slack-default.slack-bot-token.signing-secret",
    ]);

    const createdCredentials = await fixture.db.query.integrationCredentials.findMany({
      where: (table, { and, eq, inArray }) =>
        and(
          inArray(
            table.id,
            createdLinks.map((link) => link.credentialId),
          ),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
      orderBy: (table, { asc }) => [asc(table.id)],
    });

    expect(createdCredentials).toHaveLength(2);
    expect(createdCredentials.map((credential) => credential.secretKind)).toEqual([
      IntegrationCredentialSecretKinds.API_KEY,
      IntegrationCredentialSecretKinds.API_KEY,
    ]);

    const webhookSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.integrationConnectionId, responseBody.id),
          eq(table.targetKey, "slack-default"),
        ),
    });

    expect(webhookSource).toBeDefined();
    if (webhookSource === undefined) {
      throw new Error("Expected Slack implicit webhook source.");
    }

    expect(webhookSource.endpointKey).toBeDefined();
    expect(webhookSource.endpointKey.length).toBeGreaterThan(0);
  });

  it("creates Datadog API key connections with application keys", async ({ fixture }) => {
    await upsertDatadogTarget({ fixture, targetKey: "datadog-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-datadog-api-key@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/datadog-default/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "Datadog MCP",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "datadog-api-key",
          applicationKey: "datadog-application-key",
        },
      }),
    });

    expect(response.status).toBe(201);
    const responseBody = IntegrationConnectionSchema.parse(await response.json());
    expect(responseBody.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    });
    expect(responseBody.targetSnapshotConfig).toEqual({});

    const createdLinks = await fixture.db.query.integrationConnectionCredentials.findMany({
      where: (table, { eq }) => eq(table.connectionId, responseBody.id),
      orderBy: (table, { asc }) => [asc(table.slotKey)],
    });

    expect(createdLinks.map((link) => link.slotKey)).toEqual([
      DatadogCredentialSlotKeys.API_KEY,
      DatadogCredentialSlotKeys.APPLICATION_KEY,
    ]);

    const createdCredentials = await fixture.db.query.integrationCredentials.findMany({
      where: (table, { and, eq, inArray }) =>
        and(
          inArray(
            table.id,
            createdLinks.map((link) => link.credentialId),
          ),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
      orderBy: (table, { asc }) => [asc(table.id)],
    });

    expect(createdCredentials).toHaveLength(2);
    expect(createdCredentials.map((credential) => credential.secretKind)).toEqual([
      IntegrationCredentialSecretKinds.API_KEY,
      IntegrationCredentialSecretKinds.API_KEY,
    ]);
  });

  it("creates GitHub App form connections and the implicit webhook source", async ({ fixture }) => {
    await upsertGitHubTarget({ fixture, targetKey: "github-cloud" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-github-app@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/github-cloud/form", {
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
          appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
          webhookSecret: "github-webhook-secret",
        },
      }),
    });

    expect(response.status).toBe(201);
    const responseBody = IntegrationConnectionSchema.parse(await response.json());
    expect(responseBody.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      app_id: "123",
      app_slug: "mistle-github-app",
    });
    expect(responseBody.targetSnapshotConfig).toEqual({
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    });

    const createdLinks = await fixture.db.query.integrationConnectionCredentials.findMany({
      where: (table, { eq }) => eq(table.connectionId, responseBody.id),
      orderBy: (table, { asc }) => [asc(table.slotKey)],
    });

    expect(createdLinks.map((link) => link.slotKey)).toEqual([
      "github.github-cloud.github-app-installation.app-private-key-pem",
      "github.github-cloud.github-app-installation.webhook-secret",
    ]);

    const createdCredentials = await fixture.db.query.integrationCredentials.findMany({
      where: (table, { and, eq, inArray }) =>
        and(
          inArray(
            table.id,
            createdLinks.map((link) => link.credentialId),
          ),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
      orderBy: (table, { asc }) => [asc(table.id)],
    });

    expect(createdCredentials).toHaveLength(2);
    expect(createdCredentials.map((credential) => credential.secretKind)).toEqual([
      IntegrationCredentialSecretKinds.API_KEY,
      IntegrationCredentialSecretKinds.API_KEY,
    ]);

    const webhookSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.integrationConnectionId, responseBody.id),
          eq(table.targetKey, "github-cloud"),
        ),
    });

    expect(webhookSource).toBeDefined();
    if (webhookSource === undefined) {
      throw new Error("Expected GitHub App implicit webhook source.");
    }

    expect(webhookSource.endpointKey).toBeDefined();
    expect(webhookSource.endpointKey.length).toBeGreaterThan(0);
  });

  it("returns 400 when Jira personal token config is missing site_url", async ({ fixture }) => {
    await upsertJiraTarget({ fixture, targetKey: "jira-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-jira-personal-missing-site-url@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/jira-default/form", {
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
          email: "user@example.com",
        },
        secrets: {
          apiKey: "jira-personal-token",
        },
      }),
    });

    expect(response.status).toBe(400);
    const responseBody = CreateFormConnectionBadRequestResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      code: "INVALID_CREATE_CONNECTION_INPUT",
      message: `Connection config for method '${JiraConnectionMethodIds.PERSONAL_API_TOKEN}' is invalid.`,
    });
  });

  it("returns 400 when Jira service account token config is missing cloud_id", async ({
    fixture,
  }) => {
    await upsertJiraTarget({ fixture, targetKey: "jira-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-jira-service-missing-cloud-id@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/jira-default/form", {
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
        },
        secrets: {
          apiKey: "jira-service-account-token",
        },
      }),
    });

    expect(response.status).toBe(400);
    const responseBody = CreateFormConnectionBadRequestResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      code: "INVALID_CREATE_CONNECTION_INPUT",
      message: `Connection config for method '${JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN}' is invalid.`,
    });
  });

  it("returns 404 when target exists but is disabled", async ({ fixture }) => {
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-disabled",
      familyId: "openai",
      variantId: "openai-default",
      enabled: false,
      config: {
        api_base_url: "https://api.openai.com",
      },
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-form-disabled-target@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/openai-disabled/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "Disabled target",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-test-disabled-target",
        },
      }),
    });

    expect(response.status).toBe(404);
    const responseBody = CreateFormConnectionNotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("TARGET_NOT_FOUND");
  });

  it("returns 400 for invalid create body payload", async ({ fixture }) => {
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default",
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

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-form-validation@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/openai-default/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "",
        methodId: "",
        config: {},
        secrets: {
          apiKey: "",
        },
      }),
    });

    expect(response.status).toBe(400);
    const responseBody = ValidationErrorResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("returns 401 when request is unauthenticated", async ({ fixture }) => {
    const response = await fixture.request("/v1/integration/connections/openai-default/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        displayName: "Unauthenticated",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-test-unauthenticated",
        },
      }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });

  it("does not create connection records when target lookup fails", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-form-no-records@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/missing_target/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "Missing target connection",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-test-no-records",
        },
      }),
    });

    expect(response.status).toBe(404);

    const connectionRows = await fixture.db
      .select({
        id: integrationConnections.id,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, authenticatedSession.organizationId));
    expect(connectionRows).toHaveLength(0);

    const credentialRows = await fixture.db
      .select({
        id: integrationCredentials.id,
      })
      .from(integrationCredentials)
      .where(eq(integrationCredentials.organizationId, authenticatedSession.organizationId));
    expect(credentialRows).toHaveLength(0);

    const connectionCredentialRows = await fixture.db
      .select({
        connectionId: integrationConnectionCredentials.connectionId,
      })
      .from(integrationConnectionCredentials)
      .innerJoin(
        integrationConnections,
        eq(integrationConnections.id, integrationConnectionCredentials.connectionId),
      )
      .where(eq(integrationConnections.organizationId, authenticatedSession.organizationId));
    expect(connectionCredentialRows).toHaveLength(0);
  });
});

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

async function upsertAwsTarget(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
}) {
  await input.fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "aws",
      variantId: "aws-cli-default",
      enabled: true,
      config: {},
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "aws",
        variantId: "aws-cli-default",
        enabled: true,
        config: {},
      },
    });
}

async function upsertDatadogTarget(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
}) {
  await input.fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "datadog",
      variantId: "datadog-default",
      enabled: true,
      config: {},
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "datadog",
        variantId: "datadog-default",
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
