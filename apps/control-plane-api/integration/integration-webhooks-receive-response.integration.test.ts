import {
  integrationConnections,
  integrationCredentials,
  integrationTargets,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationRegistry,
  IntegrationWebhookSourceLifecycles,
  IntegrationWebhookSourceOwnerScopes,
  IntegrationWebhookSourceRoutingStrategies,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { eq, sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import { createFormConnection } from "../src/integration-connections/services/create-form-connection.js";
import { createIntegrationWebhookSource } from "../src/integration-connections/services/webhook-sources.js";
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
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          inputType: "password",
          secretType: "api_key",
          slotKey: "test-webhook.test-webhook-response.api-key.api-key",
        },
      ],
    },
  ],
  webhookSource: {
    ownerScope: IntegrationWebhookSourceOwnerScopes.TARGET,
    routingStrategy: IntegrationWebhookSourceRoutingStrategies.PAYLOAD,
    lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
    async describeSource(input) {
      return {
        displayName: input.source.displayName ?? "Immediate response webhook",
        callbackUrl: `/v1/integration/webhooks/${input.targetKey}`,
        providerMetadata: input.source.providerMetadata,
      };
    },
  },
  webhookHandler: {
    resolveWebhookRequest(input) {
      return {
        kind: "response",
        verification: "skip",
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

const VerifiedResponseConnectionConfigSchema = z
  .object({
    connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
  })
  .strict();

const ImmediateManagedResponseWebhookDefinition: IntegrationDefinition<
  typeof ResponseTargetConfigSchema,
  typeof ResponseTargetSecretSchema,
  typeof ResponseBindingConfigSchema,
  z.output<typeof VerifiedResponseConnectionConfigSchema>
> = {
  familyId: "test-webhook",
  variantId: "test-webhook-response-immediate-managed",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Test Immediate Managed Webhook Response",
  logoKey: "test-webhook-response-immediate-managed",
  targetConfigSchema: ResponseTargetConfigSchema,
  targetSecretSchema: ResponseTargetSecretSchema,
  bindingConfigSchema: ResponseBindingConfigSchema,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          inputType: "password",
          secretType: "api_key",
          slotKey: "test-webhook.test-webhook-response-immediate-managed.api-key.api-key",
        },
      ],
      configSchema: VerifiedResponseConnectionConfigSchema,
    },
  ],
  webhookSource: {
    ownerScope: IntegrationWebhookSourceOwnerScopes.CONNECTION,
    routingStrategy: IntegrationWebhookSourceRoutingStrategies.PATH,
    lifecycle: IntegrationWebhookSourceLifecycles.MANAGED,
    async describeSource(input) {
      const endpointKey = input.source.endpointKey;
      if (endpointKey === undefined) {
        throw new Error(`Managed webhook source '${input.source.id}' is missing endpointKey.`);
      }

      return {
        displayName: input.source.displayName ?? "Immediate managed response webhook",
        callbackUrl: `/v1/integration/webhooks/${input.targetKey}/${endpointKey}`,
        providerMetadata: input.source.providerMetadata,
      };
    },
    async createRegistration(input) {
      const endpointKey = input.source.endpointKey;
      if (endpointKey === undefined) {
        throw new Error(`Managed webhook source '${input.source.id}' is missing endpointKey.`);
      }

      return {
        providerMetadata: {
          callbackUrl: `/v1/integration/webhooks/${input.targetKey}/${endpointKey}`,
        },
      };
    },
  },
  webhookHandler: {
    resolveWebhookRequest(input) {
      return {
        kind: "response",
        verification: "skip",
        response: {
          status: 200,
          contentType: "text/plain",
          body: new TextDecoder().decode(input.rawBody),
        },
      };
    },
    resolveConnection() {
      throw new Error(
        "resolveConnection should not be called for immediate managed webhook responses.",
      );
    },
    verify() {
      throw new Error("verify should not be called for immediate managed webhook responses.");
    },
  },
  compileBinding: () => ({
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
  }),
};

const VerifiedImmediateResponseWebhookDefinition: IntegrationDefinition<
  typeof ResponseTargetConfigSchema,
  typeof ResponseTargetSecretSchema,
  typeof ResponseBindingConfigSchema,
  z.output<typeof VerifiedResponseConnectionConfigSchema>
> = {
  familyId: "test-webhook",
  variantId: "test-webhook-response-verified",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Test Verified Webhook Response",
  logoKey: "test-webhook-response-verified",
  targetConfigSchema: ResponseTargetConfigSchema,
  targetSecretSchema: ResponseTargetSecretSchema,
  bindingConfigSchema: ResponseBindingConfigSchema,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          inputType: "password",
          secretType: "api_key",
          slotKey: "test-webhook.test-webhook-response-verified.api-key.api-key",
        },
      ],
      configSchema: VerifiedResponseConnectionConfigSchema,
    },
  ],
  webhookSource: {
    ownerScope: IntegrationWebhookSourceOwnerScopes.TARGET,
    routingStrategy: IntegrationWebhookSourceRoutingStrategies.PAYLOAD,
    lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
    async describeSource(input) {
      return {
        displayName: input.source.displayName ?? "Verified response webhook",
        callbackUrl: `/v1/integration/webhooks/${input.targetKey}`,
        providerMetadata: input.source.providerMetadata,
      };
    },
  },
  webhookHandler: {
    resolveWebhookRequest(input) {
      return {
        kind: "response",
        verification: "required",
        event: {
          externalEventId: "evt_verified_response",
          externalDeliveryId: "delivery_verified_response",
          providerEventType: "url_verification",
          eventType: "slack:url_verification",
          payload: {
            challenge: new TextDecoder().decode(input.rawBody),
          },
        },
        response: {
          status: 200,
          contentType: "text/plain",
          body: new TextDecoder().decode(input.rawBody),
        },
      };
    },
    resolveConnection(input) {
      const candidate = input.candidates[0];
      if (candidate === undefined) {
        return {
          ok: false,
          code: "connection-not-found",
          message: "No active connection matched the verified response request.",
        };
      }

      return {
        ok: true,
        connectionId: candidate.id,
      };
    },
    verify(input) {
      if (input.connectionSecrets.apiKey !== "verified-response-secret") {
        return {
          ok: false,
          code: "invalid-signature",
          message: "Expected connection-owned secret to be resolved for verify.",
        };
      }

      return { ok: true };
    },
  },
  compileBinding: () => ({
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
  }),
};

const VerifiedManagedResponseWebhookDefinition: IntegrationDefinition<
  typeof ResponseTargetConfigSchema,
  typeof ResponseTargetSecretSchema,
  typeof ResponseBindingConfigSchema,
  z.output<typeof VerifiedResponseConnectionConfigSchema>
> = {
  familyId: "test-webhook",
  variantId: "test-webhook-response-verified-managed",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Test Verified Managed Webhook Response",
  logoKey: "test-webhook-response-verified-managed",
  targetConfigSchema: ResponseTargetConfigSchema,
  targetSecretSchema: ResponseTargetSecretSchema,
  bindingConfigSchema: ResponseBindingConfigSchema,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          inputType: "password",
          secretType: "api_key",
          slotKey: "test-webhook.test-webhook-response-verified-managed.api-key.api-key",
        },
      ],
      configSchema: VerifiedResponseConnectionConfigSchema,
    },
  ],
  webhookSource: {
    ownerScope: IntegrationWebhookSourceOwnerScopes.CONNECTION,
    routingStrategy: IntegrationWebhookSourceRoutingStrategies.PATH,
    lifecycle: IntegrationWebhookSourceLifecycles.MANAGED,
    async describeSource(input) {
      const endpointKey = input.source.endpointKey;
      if (endpointKey === undefined) {
        throw new Error(`Managed webhook source '${input.source.id}' is missing endpointKey.`);
      }

      return {
        displayName: input.source.displayName ?? "Verified managed response webhook",
        callbackUrl: `/v1/integration/webhooks/${input.targetKey}/${endpointKey}`,
        providerMetadata: input.source.providerMetadata,
      };
    },
    async createRegistration(input) {
      const endpointKey = input.source.endpointKey;
      if (endpointKey === undefined) {
        throw new Error(`Managed webhook source '${input.source.id}' is missing endpointKey.`);
      }

      return {
        providerMetadata: {
          callbackUrl: `/v1/integration/webhooks/${input.targetKey}/${endpointKey}`,
        },
      };
    },
  },
  webhookHandler: {
    resolveWebhookRequest(input) {
      return {
        kind: "response",
        verification: "required",
        event: {
          externalEventId: "evt_verified_managed_response",
          externalDeliveryId: "delivery_verified_managed_response",
          providerEventType: "url_verification",
          eventType: "slack:url_verification",
          payload: {
            challenge: new TextDecoder().decode(input.rawBody),
          },
        },
        response: {
          status: 200,
          contentType: "text/plain",
          body: new TextDecoder().decode(input.rawBody),
        },
      };
    },
    resolveConnection(input) {
      const candidate = input.candidates[0];
      if (candidate === undefined) {
        return {
          ok: false,
          code: "connection-not-found",
          message: "No active connection matched the verified managed response request.",
        };
      }

      return {
        ok: true,
        connectionId: candidate.id,
      };
    },
    verify(input) {
      if (input.connectionSecrets.apiKey !== "verified-response-secret") {
        return {
          ok: false,
          code: "invalid-signature",
          message: "Expected connection-owned secret to be resolved for verify.",
        };
      }

      if (typeof input.webhookSourceSecrets.webhookSecret !== "string") {
        return {
          ok: false,
          code: "invalid-signature",
          message: "Expected webhook-source secret to be resolved for verify.",
        };
      }

      return { ok: true };
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
        endpointKey: undefined,
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

  it("returns an immediate response without loading malformed active connections", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-webhooks-receive-response-immediate-malformed@example.com",
    });
    const targetKey = "test-webhook-response-target-with-malformed-connection";
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

    await fixture.db.insert(integrationConnections).values({
      organizationId: authenticatedSession.organizationId,
      targetKey,
      displayName: "Malformed active connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: null,
      targetSnapshotConfig: {},
    });

    const receivedWebhook = await receiveIntegrationWebhook(
      {
        db: fixture.db,
        integrationRegistry: registry,
        integrationsConfig: fixture.config.integrations,
      },
      {
        targetKey,
        endpointKey: undefined,
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
  });

  it("returns an immediate path-routed response without resolving webhook-source secrets", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-webhooks-receive-response-immediate-managed@example.com",
    });
    const targetKey = "test-webhook-response-immediate-managed-target";
    const registry = new IntegrationRegistry();
    registry.register(ImmediateManagedResponseWebhookDefinition);

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: ImmediateManagedResponseWebhookDefinition.familyId,
      variantId: ImmediateManagedResponseWebhookDefinition.variantId,
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
        displayName: "Immediate managed response connection",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "immediate-managed-response-secret",
        },
      },
    );

    const createdWebhookSource = await createIntegrationWebhookSource(
      {
        db: fixture.db,
        integrationRegistry: registry,
        integrationsConfig: fixture.config.integrations,
        controlPlaneBaseUrl: fixture.config.auth.baseUrl,
      },
      {
        organizationId: authenticatedSession.organizationId,
        connectionId: createdConnection.id,
        displayName: "Immediate managed response webhook",
      },
    );

    const persistedSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, createdWebhookSource.id),
      columns: {
        webhookSecretCredentialId: true,
      },
    });

    if (persistedSource?.webhookSecretCredentialId === null || persistedSource === undefined) {
      throw new Error(
        `Expected webhook source '${createdWebhookSource.id}' to have a secret credential.`,
      );
    }

    await fixture.db
      .update(integrationCredentials)
      .set({
        revokedAt: sql`now()`,
      })
      .where(eq(integrationCredentials.id, persistedSource.webhookSecretCredentialId));

    const receivedWebhook = await receiveIntegrationWebhook(
      {
        db: fixture.db,
        integrationRegistry: registry,
        integrationsConfig: fixture.config.integrations,
      },
      {
        targetKey,
        endpointKey: createdWebhookSource.endpointKey,
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
  });

  it("verifies required immediate responses against connection-owned secrets before returning", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-webhooks-receive-response-verified@example.com",
    });
    const targetKey = "test-webhook-response-verified-target";
    const registry = new IntegrationRegistry();
    registry.register(VerifiedImmediateResponseWebhookDefinition);

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: VerifiedImmediateResponseWebhookDefinition.familyId,
      variantId: VerifiedImmediateResponseWebhookDefinition.variantId,
      enabled: true,
      config: {},
      secrets: null,
    });

    await createFormConnection(
      {
        db: fixture.db,
        integrationRegistry: registry,
        integrationsConfig: fixture.config.integrations,
      },
      {
        organizationId: authenticatedSession.organizationId,
        targetKey,
        displayName: "Verified response connection",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "verified-response-secret",
        },
      },
    );

    const receivedWebhook = await receiveIntegrationWebhook(
      {
        db: fixture.db,
        integrationRegistry: registry,
        integrationsConfig: fixture.config.integrations,
      },
      {
        targetKey,
        endpointKey: undefined,
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

  it("verifies required immediate responses with both connection and webhook-source secrets", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-webhooks-receive-response-verified-managed@example.com",
    });
    const targetKey = "test-webhook-response-verified-managed-target";
    const registry = new IntegrationRegistry();
    registry.register(VerifiedManagedResponseWebhookDefinition);

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: VerifiedManagedResponseWebhookDefinition.familyId,
      variantId: VerifiedManagedResponseWebhookDefinition.variantId,
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
        displayName: "Verified managed response connection",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "verified-response-secret",
        },
      },
    );

    const createdWebhookSource = await createIntegrationWebhookSource(
      {
        db: fixture.db,
        integrationRegistry: registry,
        integrationsConfig: fixture.config.integrations,
        controlPlaneBaseUrl: fixture.config.auth.baseUrl,
      },
      {
        organizationId: authenticatedSession.organizationId,
        connectionId: createdConnection.id,
        displayName: "Verified managed response webhook",
      },
    );

    const receivedWebhook = await receiveIntegrationWebhook(
      {
        db: fixture.db,
        integrationRegistry: registry,
        integrationsConfig: fixture.config.integrations,
      },
      {
        targetKey,
        endpointKey: createdWebhookSource.endpointKey,
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
