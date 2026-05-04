/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { JiraConnectionMethodIds } from "@mistle/integrations-definitions";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  CreateIntegrationWebhookSourceBadRequestResponseSchema,
  CreateIntegrationWebhookSourceBodySchema,
} from "../src/integration-connections/create-integration-webhook-source/schema.js";
import { CreatedFormIntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import { createFormConnection, seedIntegrationTarget } from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration connection webhook sources create integration", () => {
  it("rejects Jira webhook source creation for service-account connections", async ({ env }) => {
    await seedJiraTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-webhook-sources-jira-service-account@example.com",
    });
    const createConnectionResponse = await createFormConnection({
      env,
      targetKey: "jira-default",
      cookie: session.cookie,
      body: {
        displayName: "Service account Jira",
        methodId: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
        config: {
          connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
          cloud_id: "cloud-123",
        },
        secrets: {
          apiKey: "jira-service-account-token",
        },
      },
    });
    expect(createConnectionResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createConnectionResponse.json(),
    );

    const response = await env.controlPlaneApi.http.fetch(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/webhook-sources`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
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
    expect(responseBody.code).toBe("WEBHOOK_SOURCE_NOT_SUPPORTED");
    expect(responseBody.message).toContain("does not support webhook sources");
  });
});

async function seedJiraTarget(env: IntegrationTestEnvironment): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "jira-default",
    familyId: "jira",
    variantId: "jira-default",
    config: {},
  });
}
