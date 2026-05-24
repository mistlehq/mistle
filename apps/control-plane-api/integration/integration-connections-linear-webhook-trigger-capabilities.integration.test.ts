/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  IntegrationWebhookSourceStatuses,
} from "@mistle/db/control-plane";
import {
  IntegrationConnectionMethodIds,
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
} from "@mistle/integrations-core";
import {
  LinearCredentialSlotKeys,
  LinearManagedWebhookResourceTypes,
} from "@mistle/integrations-definitions";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { ListIntegrationConnectionsResponseSchema } from "../src/integration-connections/list-integration-connections/schema.js";
import {
  seedConnectionCredential,
  seedIntegrationTarget,
} from "./helpers/integration-connections.js";

const LinearTargetKey = "linear_default_trigger_capabilities_refresh";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("Linear webhook trigger capability refresh", () => {
  it("exposes the managed Linear webhook trigger capability refresh action", async ({ env }) => {
    await seedLinearTarget(env);
    const session = await env.auth.createSession({
      email: "integration-linear-trigger-capabilities-refresh@example.com",
    });
    const connectionId = "icn_linear_trigger_capabilities_refresh";
    const sourceId = "iws_linear_trigger_capabilities_refresh";

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
      id: connectionId,
      organizationId: session.organizationId,
      targetKey: LinearTargetKey,
      displayName: "Linear",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
    });
    await seedConnectionCredential({
      env,
      organizationId: session.organizationId,
      connectionId,
      slotKey: LinearCredentialSlotKeys.API_KEY,
      secretKind: IntegrationCredentialSecretKinds.API_KEY,
      intendedFamilyId: "linear",
      plaintext: "lin_api_test_key",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationWebhookSources).values({
      id: sourceId,
      organizationId: session.organizationId,
      integrationConnectionId: connectionId,
      targetKey: LinearTargetKey,
      endpointKey: "linear-trigger-capabilities-refresh",
      remoteRegistrationId: "linear-webhook-id",
      status: IntegrationWebhookSourceStatuses.ACTIVE,
      providerMetadata: {
        // Existing Linear webhook rows can predate newly added Mistle trigger definitions.
        // Refresh keeps the trigger picker in sync without recreating the provider webhook.
        registeredResourceTypes: [...LinearManagedWebhookResourceTypes],
        [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
          events: ["Issue"],
          permissions: [{ permission: "workspace-admin" }],
        },
      },
    });

    const listBeforeRefresh = await listConnections({
      env,
      cookie: session.cookie,
    });
    const listedConnection = listBeforeRefresh.items.find((item) => item.id === connectionId);
    if (listedConnection === undefined) {
      throw new Error(`Expected listed Linear connection '${connectionId}'.`);
    }
    expect(listedConnection.webhookTriggerCapabilitiesRefreshAction).toEqual({
      actionLabel: "Sync webhook events",
      pendingLabel: "Syncing...",
    });
  });
});

async function seedLinearTarget(env: IntegrationTestEnvironment): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: LinearTargetKey,
    familyId: "linear",
    variantId: "linear-default",
    config: {},
  });
}

async function listConnections(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
}): Promise<ReturnType<typeof ListIntegrationConnectionsResponseSchema.parse>> {
  const response = await input.env.controlPlaneApi.http.fetch("/v1/integration/connections", {
    headers: {
      cookie: input.cookie,
    },
  });

  expect(response.status).toBe(200);
  return ListIntegrationConnectionsResponseSchema.parse(await response.json());
}
