import {
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  createIntegrationRegistry,
  JiraConnectionMethodIds,
} from "@mistle/integrations-definitions";
import { describe, expect } from "vitest";

import {
  CreateIntegrationWebhookSourceBadRequestResponseSchema,
  CreateIntegrationWebhookSourceBodySchema,
} from "../src/integration-connections/create-integration-webhook-source/schema.js";
import {
  resolveConnectionSecretsOrThrow,
  resolveConnectionWithTargetOrThrow,
} from "../src/integration-connections/services/webhook-sources.js";
import { it } from "./test-context.js";

describe("integration connection webhook sources integration", () => {
  it("lists the implicit webhook source created with a GitHub App form connection", async ({
    fixture,
  }) => {
    const targetKey = "github-cloud-implicit-webhook-source";
    const authenticatedSession = await fixture.authSession({
      email: "integration-connection-webhook-sources-github-implicit@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey,
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

    const createConnectionResponse = await fixture.request(
      "/v1/integration/connections/github-cloud-implicit-webhook-source/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "GitHub App Installation",
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
      },
    );
    expect(createConnectionResponse.status).toBe(201);
    const createdConnection = (await createConnectionResponse.json()) as {
      id: string;
    };

    const response = await fixture.request(
      `/v1/integration/connections/${createdConnection.id}/webhook-sources`,
      {
        method: "GET",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      targetKey,
      integrationConnectionId: createdConnection.id,
    });
    expect(body[0]?.callbackUrl).toContain(`/v1/integration/webhooks/${targetKey}/`);
    expect(body[0]?.endpointKey).toBeTruthy();

    const persistedSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.targetKey, targetKey),
          eq(table.integrationConnectionId, createdConnection.id),
        ),
    });

    expect(persistedSource).toBeDefined();
    if (persistedSource === undefined) {
      throw new Error("Expected the connection-owned implicit GitHub webhook source to persist.");
    }

    expect(persistedSource.endpointKey).toBeTruthy();
  });

  it("does not expose webhook sources for GitHub API key connections", async ({ fixture }) => {
    const targetKey = "github-cloud-api-key-no-webhooks";
    const authenticatedSession = await fixture.authSession({
      email: "integration-connection-webhook-sources-github-api-key@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey,
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

    await fixture.db.insert(integrationConnections).values({
      id: "icn_github_api_key_no_webhooks",
      organizationId: authenticatedSession.organizationId,
      targetKey,
      displayName: "GitHub API key",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      targetSnapshotConfig: {
        apiBaseUrl: "https://api.github.com",
        webBaseUrl: "https://github.com",
      },
    });

    const response = await fixture.request(
      "/v1/integration/connections/icn_github_api_key_no_webhooks/webhook-sources",
      {
        method: "GET",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);

    const persistedSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { eq }) => eq(table.integrationConnectionId, "icn_github_api_key_no_webhooks"),
    });
    expect(persistedSource).toBeUndefined();
  });

  it("rejects Jira webhook source creation for service-account connections", async ({
    fixture,
  }) => {
    const targetKey = "jira-default";
    const authenticatedSession = await fixture.authSession({
      email: "integration-connection-webhook-sources-jira-service-account@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey,
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

    const createConnectionResponse = await fixture.request(
      "/v1/integration/connections/jira-default/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Service account Jira",
          methodId: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
          config: {
            connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
            cloud_id: "cloud-123",
          },
          secrets: {
            apiKey: "jira-service-account-token",
          },
        }),
      },
    );
    expect(createConnectionResponse.status).toBe(201);
    const createdConnection = (await createConnectionResponse.json()) as {
      id: string;
    };

    const response = await fixture.request(
      `/v1/integration/connections/${createdConnection.id}/webhook-sources`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify(
          CreateIntegrationWebhookSourceBodySchema.parse({
            displayName: "Managed Jira webhook",
          }),
        ),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = CreateIntegrationWebhookSourceBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("INVALID_WEBHOOK_SOURCE_INPUT");
    expect(responseBody.message).toContain("personal API token");
  });

  it("resolves Jira personal PAT webhook secrets from linked credentials", async ({ fixture }) => {
    const targetKey = "jira-default";
    const authenticatedSession = await fixture.authSession({
      email: "integration-connection-webhook-sources-jira-personal@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey,
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

    const createConnectionResponse = await fixture.request(
      "/v1/integration/connections/jira-default/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Personal Jira",
          methodId: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
          config: {
            connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
            site_url: "https://mistle-test.atlassian.net",
            email: "jira@example.com",
          },
          secrets: {
            apiKey: "jira-personal-token",
          },
        }),
      },
    );
    expect(createConnectionResponse.status).toBe(201);
    const createdConnection = (await createConnectionResponse.json()) as {
      id: string;
    };

    const connection = await resolveConnectionWithTargetOrThrow({
      db: fixture.db,
      organizationId: authenticatedSession.organizationId,
      connectionId: createdConnection.id,
    });

    const resolvedSecrets = await resolveConnectionSecretsOrThrow({
      db: fixture.db,
      integrationRegistry: createIntegrationRegistry(),
      integrationsConfig: fixture.config.integrations,
      connection,
    });

    expect(resolvedSecrets).toEqual({
      apiKey: "jira-personal-token",
    });
  });
});
