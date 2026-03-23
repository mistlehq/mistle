import { integrationTargets } from "@mistle/db/control-plane";
import {
  IntegrationConnectionMethodIds,
  IntegrationConnectionMethodKinds,
  IntegrationKinds,
  IntegrationRegistry,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { describe, expect } from "vitest";
import { z } from "zod";

import { receiveIntegrationWebhook } from "../src/integration-webhooks/services/receive-webhook.js";
import { it } from "./test-context.js";

const ResponseTargetConfigSchema = z.object({}).strict();
const ResponseTargetSecretSchema = z.object({}).strict();
const ResponseBindingConfigSchema = z.object({}).strict();

const ImmediateResponseWebhookDefinition: IntegrationDefinition<
  typeof ResponseTargetConfigSchema,
  typeof ResponseTargetSecretSchema,
  typeof ResponseBindingConfigSchema
> = {
  familyId: "test-webhook",
  variantId: "test-webhook-response",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Test Webhook Response",
  logoKey: "test-webhook-response",
  targetConfigSchema: ResponseTargetConfigSchema,
  targetSecretSchema: ResponseTargetSecretSchema,
  bindingConfigSchema: ResponseBindingConfigSchema,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: IntegrationConnectionMethodKinds.API_KEY,
    },
  ],
  webhookHandler: {
    resolveWebhookRequest(input) {
      return {
        kind: "response",
        response: {
          status: 200,
          contentType: "text/plain",
          body: new TextDecoder().decode(input.rawBody),
        },
      };
    },
    resolveConnection() {
      throw new Error("resolveConnection should not be called for immediate webhook responses.");
    },
    verify() {
      throw new Error("verify should not be called for immediate webhook responses.");
    },
  },
  compileBinding: () => ({
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
  }),
};

describe("receive integration webhook immediate response integration", () => {
  it("returns an immediate response without persisting an event or requiring a connection", async ({
    fixture,
  }) => {
    const targetKey = "test-webhook-response-target";
    const registry = new IntegrationRegistry();
    registry.register(ImmediateResponseWebhookDefinition);

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: ImmediateResponseWebhookDefinition.familyId,
      variantId: ImmediateResponseWebhookDefinition.variantId,
      enabled: true,
      config: {},
      secrets: null,
    });

    const receivedWebhook = await receiveIntegrationWebhook(
      {
        db: fixture.db,
        integrationRegistry: registry,
        integrationsConfig: fixture.config.integrations,
      },
      {
        targetKey,
        headers: {
          "content-type": "text/plain",
        },
        rawBody: new TextEncoder().encode("challenge-value"),
      },
    );

    expect(receivedWebhook).toEqual({
      kind: "response",
      response: {
        status: 200,
        contentType: "text/plain",
        body: "challenge-value",
      },
    });

    const persistedEvents = await fixture.db.query.integrationWebhookEvents.findMany({
      where: (table, { eq }) => eq(table.targetKey, targetKey),
    });

    expect(persistedEvents).toEqual([]);
  });
});
