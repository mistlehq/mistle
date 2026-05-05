/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  createIntegrationRegistry,
  JiraConnectionMethodIds,
} from "@mistle/integrations-definitions";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { CreatedFormIntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import {
  resolveConnectionSecretsOrThrow,
  resolveConnectionWithTargetOrThrow,
} from "../src/integration-connections/services/webhook-sources.js";
import {
  createFormConnection,
  IntegrationIntegrationsConfig,
  seedIntegrationTarget,
} from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration connection webhook sources secrets integration", () => {
  it("resolves Jira personal PAT webhook secrets from linked credentials", async ({ env }) => {
    await seedJiraTarget(env);
    const session = await env.auth.createSession({
      email: "integration-webhook-sources-jira-personal@example.com",
    });
    const createConnectionResponse = await createFormConnection({
      env,
      targetKey: "jira-default",
      cookie: session.cookie,
      body: {
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
      },
    });
    expect(createConnectionResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createConnectionResponse.json(),
    );

    const connection = await resolveConnectionWithTargetOrThrow({
      db: env.controlPlaneDb,
      organizationId: session.organizationId,
      connectionId: createdConnection.id,
    });
    const resolvedSecrets = await resolveConnectionSecretsOrThrow({
      db: env.controlPlaneDb,
      integrationRegistry: createIntegrationRegistry(),
      integrationsConfig: IntegrationIntegrationsConfig,
      connection,
    });

    expect(resolvedSecrets).toEqual({
      apiKey: "jira-personal-token",
    });
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
