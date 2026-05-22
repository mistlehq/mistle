/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  TriggerKinds,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  type IntegrationCredentialSecretKind,
  OrganizationIdentityLinkProviderConfigStatus,
  SandboxProfileVersionStates,
  type SandboxProfileVersionState,
} from "@mistle/db/control-plane";
import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationRegistry,
  IntegrationWebhookSourceLifecycles,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import { z } from "zod";

import { ListIntegrationConnectionsResponseSchema } from "../src/integration-connections/list-integration-connections/schema.js";
import { deleteIntegrationConnection } from "../src/integration-connections/services/delete-integration-connection.js";
import { IntegrationIntegrationsConfig } from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration connections delete integration", () => {
  it("deletes an unused connection and its owned credentials and webhook source", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-delete-free@example.com",
    });

    await seedTarget(env);
    await seedConnection(env, {
      connectionId: "icn_integration_new_delete_free",
      organizationId: session.organizationId,
    });
    await seedConnectionCredential(env, {
      connectionId: "icn_integration_new_delete_free",
      credentialId: "icr_integration_new_delete_free",
      organizationId: session.organizationId,
      slotKey: "github.github-cloud.api-key.api-key",
      secretKind: IntegrationCredentialSecretKinds.API_KEY,
    });
    await seedConnectionWebhookSource(env, {
      connectionId: "icn_integration_new_delete_free",
      credentialId: "icr_integration_new_delete_free_webhook_secret",
      organizationId: session.organizationId,
      sourceId: "iws_integration_new_delete_free",
    });

    const response = await deleteConnection({
      connectionId: "icn_integration_new_delete_free",
      cookie: session.cookie,
      env,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      connectionId: "icn_integration_new_delete_free",
    });
    await expectConnectionMissing(env, "icn_integration_new_delete_free");
    await expectCredentialMissing(env, "icr_integration_new_delete_free");
    await expectCredentialLinkMissing(env, {
      connectionId: "icn_integration_new_delete_free",
      credentialId: "icr_integration_new_delete_free",
    });
    await expectWebhookSourceMissing(env, "iws_integration_new_delete_free");
    await expectCredentialMissing(env, "icr_integration_new_delete_free_webhook_secret");
  });

  it("deletes draft and inactive published sandbox profile bindings with the connection", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-delete-inactive-bindings@example.com",
    });

    await seedTarget(env);
    await seedConnection(env, {
      connectionId: "icn_integration_new_delete_draft_binding",
      organizationId: session.organizationId,
    });
    await seedConnection(env, {
      connectionId: "icn_integration_new_delete_inactive_published_binding",
      organizationId: session.organizationId,
    });
    await seedBindingUsage(env, {
      activeVersion: null,
      bindingId: "ibd_integration_new_delete_draft_binding",
      connectionId: "icn_integration_new_delete_draft_binding",
      organizationId: session.organizationId,
      profileId: "spf_integration_new_delete_draft_binding",
      state: SandboxProfileVersionStates.DRAFT,
    });
    await seedBindingUsage(env, {
      activeVersion: null,
      bindingId: "ibd_integration_new_delete_inactive_published_binding",
      connectionId: "icn_integration_new_delete_inactive_published_binding",
      organizationId: session.organizationId,
      profileId: "spf_integration_new_delete_inactive_published_binding",
      state: SandboxProfileVersionStates.PUBLISHED,
    });

    const usageBeforeDelete = await listConnections(env, session.cookie);
    expectListedBindingCount({
      bindingCount: 0,
      connectionId: "icn_integration_new_delete_draft_binding",
      page: usageBeforeDelete,
    });
    expectListedBindingCount({
      bindingCount: 0,
      connectionId: "icn_integration_new_delete_inactive_published_binding",
      page: usageBeforeDelete,
    });

    const deleteDraftResponse = await deleteConnection({
      connectionId: "icn_integration_new_delete_draft_binding",
      cookie: session.cookie,
      env,
    });
    expect(deleteDraftResponse.status).toBe(200);
    await expectBindingMissing(env, "ibd_integration_new_delete_draft_binding");
    await expectConnectionMissing(env, "icn_integration_new_delete_draft_binding");

    const deleteInactivePublishedResponse = await deleteConnection({
      connectionId: "icn_integration_new_delete_inactive_published_binding",
      cookie: session.cookie,
      env,
    });
    expect(deleteInactivePublishedResponse.status).toBe(200);
    await expectBindingMissing(env, "ibd_integration_new_delete_inactive_published_binding");
    await expectConnectionMissing(env, "icn_integration_new_delete_inactive_published_binding");
  });

  it("deletes the connection when provider authorization revocation fails", async ({ env }) => {
    const simulatedProvider = await startSimulatedRevocationFailureProvider();
    const session = await env.auth.createSession({
      email: "integration-new-connections-delete-revocation-failure@example.com",
    });
    const connectionId = "icn_integration_new_delete_revocation_failure";

    try {
      await seedRevocationFailureTarget(env, {
        revocationUrl: simulatedProvider.revocationUrl,
      });
      await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
        id: connectionId,
        organizationId: session.organizationId,
        targetKey: "revocation_failure_connections_delete",
        displayName: "Revocation failure",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        },
      });

      await deleteIntegrationConnection(
        {
          db: env.controlPlaneDb,
          integrationRegistry: createRevocationFailureIntegrationRegistry(),
          integrationsConfig: IntegrationIntegrationsConfig,
          controlPlaneBaseUrl: env.controlPlaneApi.hostBaseUrl,
        },
        {
          organizationId: session.organizationId,
          connectionId,
        },
      );

      expect(simulatedProvider.requests).toEqual(["POST /revoke"]);
      await expectConnectionMissing(env, connectionId);
    } finally {
      await simulatedProvider.stop();
    }
  });

  it("does not revoke provider authorization when local deletion rolls back", async ({ env }) => {
    const simulatedProvider = await startSimulatedRevocationFailureProvider();
    const session = await env.auth.createSession({
      email: "integration-new-connections-delete-revocation-after-rollback@example.com",
    });
    const connectionId = "icn_integration_new_delete_revocation_after_rollback";

    try {
      await seedRevocationFailureTarget(env, {
        revocationUrl: simulatedProvider.revocationUrl,
      });
      await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
        id: connectionId,
        organizationId: session.organizationId,
        targetKey: "revocation_failure_connections_delete",
        displayName: "Revocation after rollback",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        },
      });
      await env.controlPlaneDb.insert(env.controlPlaneTables.integrationWebhookSources).values({
        id: "iws_integration_new_delete_revocation_after_rollback",
        organizationId: session.organizationId,
        integrationConnectionId: connectionId,
        targetKey: "revocation_failure_connections_delete",
        endpointKey: "ep_integration_new_delete_revocation_after_rollback",
        status: "active",
      });

      await expect(
        deleteIntegrationConnection(
          {
            db: env.controlPlaneDb,
            integrationRegistry: createRevocationFailureIntegrationRegistry(),
            integrationsConfig: IntegrationIntegrationsConfig,
            controlPlaneBaseUrl: env.controlPlaneApi.hostBaseUrl,
          },
          {
            organizationId: session.organizationId,
            connectionId,
          },
        ),
      ).rejects.toThrow("Simulated provider webhook deletion failure.");

      expect(simulatedProvider.requests).toEqual([]);
      await expectConnectionPresent(env, connectionId);
    } finally {
      await simulatedProvider.stop();
    }
  });

  it("blocks deletion while an active sandbox profile version uses the connection", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-delete-active-binding@example.com",
    });

    await seedTarget(env);
    await seedConnection(env, {
      connectionId: "icn_integration_new_delete_active_version_binding",
      organizationId: session.organizationId,
    });
    await seedBindingUsage(env, {
      activeVersion: 1,
      bindingId: "ibd_integration_new_delete_active_version_binding",
      connectionId: "icn_integration_new_delete_active_version_binding",
      organizationId: session.organizationId,
      profileId: "spf_integration_new_delete_active_version_binding",
      state: SandboxProfileVersionStates.PUBLISHED,
    });

    const usageBeforeDelete = await listConnections(env, session.cookie);
    expectListedBindingCount({
      bindingCount: 1,
      connectionId: "icn_integration_new_delete_active_version_binding",
      page: usageBeforeDelete,
    });

    const response = await deleteConnection({
      connectionId: "icn_integration_new_delete_active_version_binding",
      cookie: session.cookie,
      env,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "CONNECTION_HAS_BINDINGS",
      message:
        "This integration connection cannot be deleted while it is still used by one or more active sandbox profile versions.",
    });
    await expectConnectionPresent(env, "icn_integration_new_delete_active_version_binding");
    await expectBindingPresent(env, "ibd_integration_new_delete_active_version_binding");
  });

  it("blocks deletion while webhook triggers use the connection", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-delete-trigger@example.com",
    });

    await seedTarget(env);
    await seedConnection(env, {
      connectionId: "icn_integration_new_delete_trigger",
      organizationId: session.organizationId,
    });
    await seedWebhookTriggerUsage(env, {
      triggerId: "atm_integration_new_delete_trigger",
      triggerName: "Delete guard trigger",
      connectionId: "icn_integration_new_delete_trigger",
      organizationId: session.organizationId,
    });

    const response = await deleteConnection({
      connectionId: "icn_integration_new_delete_trigger",
      cookie: session.cookie,
      env,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "CONNECTION_HAS_TRIGGERS",
      message:
        "This integration connection cannot be deleted while it is still used by one or more webhook triggers.",
    });
    await expectConnectionPresent(env, "icn_integration_new_delete_trigger");
    expect(
      await env.controlPlaneDb.query.webhookTriggers.findFirst({
        where: (table, { eq }) => eq(table.triggerId, "atm_integration_new_delete_trigger"),
      }),
    ).toBeDefined();
  });

  it("blocks deletion while active identity linking uses the connection", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-delete-identity-linking@example.com",
    });

    await seedTarget(env);
    await seedConnection(env, {
      connectionId: "icn_integration_new_delete_identity_linking",
      organizationId: session.organizationId,
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.organizationIdentityLinkProviderConfigs)
      .values({
        id: "ilp_integration_new_delete_identity_linking",
        organizationId: session.organizationId,
        providerFamily: "github",
        status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        integrationTargetKey: "github_cloud_connections_delete",
        integrationConnectionId: "icn_integration_new_delete_identity_linking",
        createdByUserId: session.userId,
        updatedByUserId: session.userId,
      });

    const response = await deleteConnection({
      connectionId: "icn_integration_new_delete_identity_linking",
      cookie: session.cookie,
      env,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "CONNECTION_USED_BY_IDENTITY_LINKING",
      message:
        "This integration connection cannot be deleted while it is configured for Identity Linking.",
    });
    await expectConnectionPresent(env, "icn_integration_new_delete_identity_linking");
  });

  it("returns 404 when the connection does not exist in the active organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-delete-missing@example.com",
    });

    const response = await deleteConnection({
      connectionId: "icn_integration_new_delete_missing",
      cookie: session.cookie,
      env,
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "CONNECTION_NOT_FOUND",
      message: "Integration connection 'icn_integration_new_delete_missing' was not found.",
    });
  });
});

type IntegrationConnectionsPage = ReturnType<typeof ListIntegrationConnectionsResponseSchema.parse>;

type SimulatedRevocationFailureProvider = {
  revocationUrl: string;
  requests: string[];
  stop: () => Promise<void>;
};

const RevocationFailureTargetConfigSchema = z
  .object({
    revocation_url: z.url(),
  })
  .strict();
const EmptyRevocationFailureConfigSchema = z.object({}).strict();

const RevocationFailureIntegrationDefinition: IntegrationDefinition<
  typeof RevocationFailureTargetConfigSchema,
  typeof EmptyRevocationFailureConfigSchema,
  typeof EmptyRevocationFailureConfigSchema,
  Record<string, unknown>
> = {
  familyId: "revocation-failure",
  variantId: "revocation-failure",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Revocation Failure",
  logoKey: "generic",
  targetConfigSchema: RevocationFailureTargetConfigSchema,
  targetSecretSchema: EmptyRevocationFailureConfigSchema,
  bindingConfigSchema: EmptyRevocationFailureConfigSchema,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "OAuth",
      kind: "redirect",
      configSchema: z
        .object({
          connection_method: z.literal(IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE),
        })
        .strict(),
      ui: {
        create: {
          submitLabel: "Connect",
          helperText: "Authorize access.",
        },
      },
    },
  ],
  authorizationRevocation: {
    async revokeConnectionAuthorization(input) {
      await fetch(input.target.config.revocation_url, {
        method: "POST",
      });
      throw new Error("Simulated provider revocation failure.");
    },
  },
  webhookSource: {
    lifecycle: IntegrationWebhookSourceLifecycles.MANAGED,
    describeSource(input) {
      return {
        displayName: input.source.displayName ?? "Webhook",
        callbackUrl: `${input.controlPlaneBaseUrl}/integration-webhooks/${input.source.endpointKey}`,
        providerMetadata: input.source.providerMetadata,
      };
    },
    deleteRegistration() {
      throw new Error("Simulated provider webhook deletion failure.");
    },
  },
  compileBinding() {
    return {
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
    };
  },
};

function createRevocationFailureIntegrationRegistry(): IntegrationRegistry {
  const registry = new IntegrationRegistry();
  registry.register(RevocationFailureIntegrationDefinition);
  return registry;
}

async function startSimulatedRevocationFailureProvider(): Promise<SimulatedRevocationFailureProvider> {
  const requests: string[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    await readRequestBody(request);
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push(`${request.method ?? "GET"} ${requestUrl.pathname}`);

    response.statusCode = 500;
    response.end("revocation failed");
  });

  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected simulated revocation provider to listen on a TCP port.");
  }

  return {
    revocationUrl: `http://127.0.0.1:${address.port.toString()}/revoke`,
    requests,
    stop: () => close(server),
  };
}

async function seedRevocationFailureTarget(
  env: IntegrationTestEnvironment,
  input: {
    revocationUrl: string;
  },
): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationTargets)
    .values({
      targetKey: "revocation_failure_connections_delete",
      familyId: "revocation-failure",
      variantId: "revocation-failure",
      enabled: true,
      config: {
        revocation_url: input.revocationUrl,
      },
    })
    .onConflictDoUpdate({
      target: env.controlPlaneTables.integrationTargets.targetKey,
      set: {
        familyId: "revocation-failure",
        variantId: "revocation-failure",
        enabled: true,
        config: {
          revocation_url: input.revocationUrl,
        },
      },
    });
}

async function seedTarget(env: IntegrationTestEnvironment): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationTargets)
    .values({
      targetKey: "github_cloud_connections_delete",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    })
    .onConflictDoUpdate({
      target: env.controlPlaneTables.integrationTargets.targetKey,
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

async function seedConnection(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    organizationId: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
    id: input.connectionId,
    organizationId: input.organizationId,
    targetKey: "github_cloud_connections_delete",
    displayName: input.connectionId,
    status: IntegrationConnectionStatuses.ACTIVE,
  });
}

async function seedConnectionCredential(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    credentialId: string;
    organizationId: string;
    secretKind: IntegrationCredentialSecretKind;
    slotKey: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationCredentials).values({
    id: input.credentialId,
    organizationId: input.organizationId,
    secretKind: input.secretKind,
    ciphertext: `ciphertext-${input.credentialId}`,
    nonce: `nonce-${input.credentialId}`,
    organizationCredentialKeyVersion: 1,
    intendedFamilyId: "github",
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionCredentials).values({
    connectionId: input.connectionId,
    credentialId: input.credentialId,
    slotKey: input.slotKey,
  });
}

async function seedConnectionWebhookSource(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    credentialId: string;
    organizationId: string;
    sourceId: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationCredentials).values({
    id: input.credentialId,
    organizationId: input.organizationId,
    secretKind: IntegrationCredentialSecretKinds.WEBHOOK_SECRET,
    ciphertext: `ciphertext-${input.credentialId}`,
    nonce: `nonce-${input.credentialId}`,
    organizationCredentialKeyVersion: 1,
    intendedFamilyId: "github",
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationWebhookSources).values({
    id: input.sourceId,
    organizationId: input.organizationId,
    integrationConnectionId: input.connectionId,
    targetKey: "github_cloud_connections_delete",
    endpointKey: `ep_${input.sourceId}`,
    webhookSecretCredentialId: input.credentialId,
    status: "active",
  });
}

async function seedBindingUsage(
  env: IntegrationTestEnvironment,
  input: {
    activeVersion: number | null;
    bindingId: string;
    connectionId: string;
    organizationId: string;
    profileId: string;
    state: SandboxProfileVersionState;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
    id: input.profileId,
    organizationId: input.organizationId,
    displayName: input.profileId,
    activeVersion: input.activeVersion,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
    sandboxProfileId: input.profileId,
    version: 1,
    state: input.state,
    publishedAt:
      input.state === SandboxProfileVersionStates.DRAFT ? null : "2026-03-01T00:00:00.000Z",
  });
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values({
      id: input.bindingId,
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: 1,
      connectionId: input.connectionId,
      kind: IntegrationBindingKinds.GIT,
      config: {},
    });
}

async function seedWebhookTriggerUsage(
  env: IntegrationTestEnvironment,
  input: {
    triggerId: string;
    triggerName: string;
    connectionId: string;
    organizationId: string;
  },
): Promise<void> {
  const sourceId = `iws_${input.triggerId}`;

  await env.controlPlaneDb.insert(env.controlPlaneTables.triggers).values({
    id: input.triggerId,
    organizationId: input.organizationId,
    kind: TriggerKinds.WEBHOOK,
    name: input.triggerName,
    enabled: true,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationWebhookSources).values({
    id: sourceId,
    organizationId: input.organizationId,
    integrationConnectionId: input.connectionId,
    targetKey: "github_cloud_connections_delete",
    endpointKey: `ep_${input.triggerId}`,
    status: "active",
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.webhookTriggers).values({
    triggerId: input.triggerId,
    integrationWebhookSourceId: sourceId,
    eventTypes: ["issue_comment.created"],
    payloadFilter: {
      "issue_comment.created": {
        op: "eq",
        path: ["action"],
        value: "created",
      },
    },
    inputTemplate: "Handle payload",
    conversationKeyTemplate: "conversation",
    idempotencyKeyTemplate: "dedupe",
  });
}

async function listConnections(
  env: IntegrationTestEnvironment,
  cookie: string,
): Promise<IntegrationConnectionsPage> {
  const response = await env.controlPlaneApi.http.fetch("/v1/integration/connections", {
    headers: {
      cookie,
    },
  });
  expect(response.status).toBe(200);

  return ListIntegrationConnectionsResponseSchema.parse(await response.json());
}

async function deleteConnection(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  connectionId: string;
}) {
  return input.env.controlPlaneApi.http.fetch(`/v1/integration/connections/${input.connectionId}`, {
    method: "DELETE",
    headers: {
      cookie: input.cookie,
    },
  });
}

function expectListedBindingCount(input: {
  page: IntegrationConnectionsPage;
  connectionId: string;
  bindingCount: number;
}): void {
  const listedConnection = input.page.items.find(
    (connection) => connection.id === input.connectionId,
  );

  expect(listedConnection).toBeDefined();
  expect(listedConnection?.bindingCount).toBe(input.bindingCount);
}

async function expectConnectionMissing(
  env: IntegrationTestEnvironment,
  connectionId: string,
): Promise<void> {
  expect(await readConnection(env, connectionId)).toBeUndefined();
}

async function expectConnectionPresent(
  env: IntegrationTestEnvironment,
  connectionId: string,
): Promise<void> {
  expect(await readConnection(env, connectionId)).toBeDefined();
}

async function readConnection(env: IntegrationTestEnvironment, connectionId: string) {
  return env.controlPlaneDb.query.integrationConnections.findFirst({
    where: (table, { eq }) => eq(table.id, connectionId),
  });
}

async function expectBindingMissing(
  env: IntegrationTestEnvironment,
  bindingId: string,
): Promise<void> {
  expect(await readBinding(env, bindingId)).toBeUndefined();
}

async function expectBindingPresent(
  env: IntegrationTestEnvironment,
  bindingId: string,
): Promise<void> {
  expect(await readBinding(env, bindingId)).toBeDefined();
}

async function readBinding(env: IntegrationTestEnvironment, bindingId: string) {
  return env.controlPlaneDb.query.sandboxProfileVersionIntegrationBindings.findFirst({
    where: (table, { eq }) => eq(table.id, bindingId),
  });
}

async function expectCredentialMissing(
  env: IntegrationTestEnvironment,
  credentialId: string,
): Promise<void> {
  expect(
    await env.controlPlaneDb.query.integrationCredentials.findFirst({
      where: (table, { eq }) => eq(table.id, credentialId),
    }),
  ).toBeUndefined();
}

async function expectCredentialLinkMissing(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    credentialId: string;
  },
): Promise<void> {
  expect(
    await env.controlPlaneDb.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.connectionId, input.connectionId), eq(table.credentialId, input.credentialId)),
    }),
  ).toBeUndefined();
}

async function expectWebhookSourceMissing(
  env: IntegrationTestEnvironment,
  sourceId: string,
): Promise<void> {
  expect(
    await env.controlPlaneDb.query.integrationWebhookSources.findFirst({
      where: (table, { eq }) => eq(table.id, sourceId),
    }),
  ).toBeUndefined();
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  let body = "";

  for await (const chunk of request) {
    if (typeof chunk !== "string") {
      throw new Error("Expected simulated revocation request body to be decoded as UTF-8.");
    }

    body += chunk;
  }

  return body;
}
