import { integrationTargets } from "@mistle/db/control-plane";
import {
  IntegrationKinds,
  IntegrationRegistry,
  IntegrationWebhookSourceLifecycles,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { describe, expect } from "vitest";
import { z } from "zod";

import { createFormConnection } from "../src/integration-connections/services/create-form-connection.js";
import { it } from "./test-context.js";

const TestTargetConfigSchema = z.object({}).strict();
const TestTargetSecretSchema = z.object({}).strict();
const TestBindingConfigSchema = z.object({}).strict();
const TestConnectionMethodId = "test-path-token";
const TestConnectionConfigSchema = z
  .object({
    connection_method: z.literal(TestConnectionMethodId),
  })
  .strict();

const ImplicitPathWebhookDefinition: IntegrationDefinition<
  typeof TestTargetConfigSchema,
  typeof TestTargetSecretSchema,
  typeof TestBindingConfigSchema,
  z.output<typeof TestConnectionConfigSchema>
> = {
  familyId: "test-slack-shape",
  variantId: "test-path-webhook-source",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Test Path Webhook Source",
  logoKey: "test-path-webhook-source",
  targetConfigSchema: TestTargetConfigSchema,
  targetSecretSchema: TestTargetSecretSchema,
  bindingConfigSchema: TestBindingConfigSchema,
  connectionMethods: [
    {
      id: TestConnectionMethodId,
      label: "Path token",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          inputType: "password",
          secretType: "api_key",
          slotKey: "test-slack-shape.test-path-webhook-source.test-path-token.api-key",
        },
      ],
      configSchema: TestConnectionConfigSchema,
    },
  ],
  webhookSource: {
    lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
    async describeSource(input) {
      return {
        displayName: input.source.displayName ?? "Implicit path webhook",
        callbackUrl: `${input.controlPlaneBaseUrl}/v1/integration/webhooks/${input.targetKey}/${input.source.endpointKey}`,
        providerMetadata: input.source.providerMetadata,
      };
    },
  },
  compileBinding: () => ({
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
  }),
};

describe("create form connection implicit webhook source integration", () => {
  it("creates an implicit path-routed connection-owned webhook source during form connection creation", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-form-implicit-webhook-source@example.com",
    });
    const targetKey = "test-path-webhook-source-target";
    const registry = new IntegrationRegistry();
    registry.register(ImplicitPathWebhookDefinition);

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: ImplicitPathWebhookDefinition.familyId,
      variantId: ImplicitPathWebhookDefinition.variantId,
      enabled: true,
      config: {},
      secrets: null,
    });

    const createdConnection = await createFormConnection(
      {
        db: fixture.db,
        integrationRegistry: registry,
        integrationsConfig: fixture.config.integrations,
      },
      {
        organizationId: authenticatedSession.organizationId,
        targetKey,
        displayName: "Implicit path source connection",
        methodId: TestConnectionMethodId,
        config: {
          connection_method: TestConnectionMethodId,
        },
        secrets: {
          apiKey: "test-api-key",
        },
      },
    );

    const persistedSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.integrationConnectionId, createdConnection.id),
          eq(table.targetKey, targetKey),
        ),
    });

    expect(persistedSource).toBeDefined();
    if (persistedSource === undefined) {
      throw new Error("Expected implicit webhook source to be created.");
    }

    expect(typeof persistedSource.endpointKey).toBe("string");
    expect(persistedSource.endpointKey.length).toBeGreaterThan(0);
  });
});
