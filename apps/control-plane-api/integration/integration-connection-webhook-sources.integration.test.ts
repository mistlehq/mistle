import {
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  CreateIntegrationWebhookSourceBadRequestResponseSchema,
  CreateIntegrationWebhookSourceBodySchema,
} from "../src/integration-connections/create-integration-webhook-source/schema.js";
import { it } from "./test-context.js";

describe("integration connection webhook sources integration", () => {
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
