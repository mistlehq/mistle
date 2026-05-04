/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationCredentialSecretKinds } from "@mistle/db/control-plane";
import { SlackConnectionMethodIds } from "@mistle/integrations-definitions";
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

describe.concurrent("Slack form integration connections", () => {
  it("creates a Slack app connection and implicit webhook source", async ({ env }) => {
    await seedSlackTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-create-slack@example.com",
    });

    const response = await createFormConnection({
      env,
      targetKey: "slack-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "Slack bot token",
        methodId: SlackConnectionMethodIds.SLACK_APP,
        config: {
          connection_method: SlackConnectionMethodIds.SLACK_APP,
        },
        secrets: {
          botToken: "xoxb-test-bot-token",
          signingSecret: "slack-signing-secret",
        },
      }),
    });

    expect(response.status).toBe(201);
    const connection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
    expect(connection.config).toEqual({
      connection_method: SlackConnectionMethodIds.SLACK_APP,
    });
    expect(connection.targetSnapshotConfig).toEqual({
      api_base_url: "https://slack.com/api",
    });

    await expectCredentialSlots({
      env,
      connectionId: connection.id,
      organizationId: session.organizationId,
      expected: [
        {
          slotKey: "slack.slack-default.slack-bot-token.bot-token",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "xoxb-test-bot-token",
        },
        {
          slotKey: "slack.slack-default.slack-bot-token.signing-secret",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "slack-signing-secret",
        },
      ],
    });
    await expectImplicitWebhookSource({
      env,
      organizationId: session.organizationId,
      connectionId: connection.id,
      targetKey: "slack-default",
    });
  });

  it("rotates both Slack app credentials", async ({ env }) => {
    await seedSlackTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-update-slack@example.com",
    });
    const createResponse = await createFormConnection({
      env,
      targetKey: "slack-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "Slack bot token",
        methodId: SlackConnectionMethodIds.SLACK_APP,
        config: {
          connection_method: SlackConnectionMethodIds.SLACK_APP,
        },
        secrets: {
          botToken: "xoxb-original-bot-token",
          signingSecret: "original-signing-secret",
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
        displayName: "Slack bot token rotated",
        config: {
          connection_method: SlackConnectionMethodIds.SLACK_APP,
        },
        secrets: {
          botToken: "xoxb-rotated-bot-token",
          signingSecret: "rotated-signing-secret",
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.displayName).toBe("Slack bot token rotated");
    expect(updatedConnection.config).toEqual({
      connection_method: SlackConnectionMethodIds.SLACK_APP,
    });

    await expectCredentialSlots({
      env,
      connectionId: createdConnection.id,
      organizationId: session.organizationId,
      previousCredentialIds,
      expected: [
        {
          slotKey: "slack.slack-default.slack-bot-token.bot-token",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "xoxb-rotated-bot-token",
        },
        {
          slotKey: "slack.slack-default.slack-bot-token.signing-secret",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "rotated-signing-secret",
        },
      ],
    });
  });
});

async function seedSlackTarget(env: Parameters<typeof seedIntegrationTarget>[0]): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "slack-default",
    familyId: "slack",
    variantId: "slack-default",
    config: {
      api_base_url: "https://slack.com/api",
    },
  });
}
