import {
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  IntegrationWebhookSourceOwnerScopes,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  CreateIntegrationWebhookSourceBadRequestResponseSchema,
  CreateIntegrationWebhookSourceBodySchema,
} from "../src/integration-connections/create-integration-webhook-source/schema.js";
import { it } from "./test-context.js";

describe("integration connection webhook sources integration", () => {
  it("materializes a connection-owned implicit webhook source for target-owned GitHub webhook ingress", async ({
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
          app_slug: "mistle-github-app",
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
            app_slug: "mistle-github-app",
          },
        },
      });

    await fixture.db.insert(integrationConnections).values({
      id: "icn_github_implicit_webhook_source",
      organizationId: authenticatedSession.organizationId,
      targetKey,
      displayName: "GitHub App Installation",
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: "12345",
      config: {
        connection_method: "github-app-installation",
        installation_id: "12345",
      },
      targetSnapshotConfig: {
        apiBaseUrl: "https://api.github.com",
        webBaseUrl: "https://github.com",
        appSlug: "mistle-github-app",
      },
    });

    const response = await fixture.request(
      "/v1/integration/connections/icn_github_implicit_webhook_source/webhook-sources",
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
      ownerScope: "connection",
      integrationConnectionId: "icn_github_implicit_webhook_source",
    });

    const persistedSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.targetKey, targetKey),
          eq(table.ownerScope, IntegrationWebhookSourceOwnerScopes.CONNECTION),
          eq(table.integrationConnectionId, "icn_github_implicit_webhook_source"),
        ),
    });

    expect(persistedSource).toBeDefined();
    if (persistedSource === undefined) {
      throw new Error("Expected the connection-owned implicit GitHub webhook source to persist.");
    }
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

    await fixture.db.insert(integrationConnections).values({
      id: "icn_jira_service_account",
      organizationId: authenticatedSession.organizationId,
      targetKey,
      displayName: "Service account Jira",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "jira-service-account-api-token",
        cloud_id: "cloud-123",
      },
    });

    const response = await fixture.request(
      "/v1/integration/connections/icn_jira_service_account/webhook-sources",
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
});
