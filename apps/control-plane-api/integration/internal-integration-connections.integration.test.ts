/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { SyncIntegrationConnectionResourcesWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { describe, expect } from "vitest";

import { RefreshIntegrationConnectionResourcesResponseSchema } from "../src/integration-connections/refresh-integration-connection-resources/schema.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal/index.js";
import { INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "../src/internal/integration-connections/index.js";
import { countQueuedControlPlaneWorkflows } from "./helpers/control-plane-workflows.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("internal integration connections", () => {
  it("requests resource refresh through the internal route and reuses the single-flight service", async ({
    env,
  }) => {
    await seedConnection(env);
    const expectedWorkflowInput = {
      organizationId: "org_internal_resource_refresh",
      connectionId: "icn_internal_refresh_001",
      kind: "repository",
    };

    const workflowRunCountBefore = await countQueuedControlPlaneWorkflows({
      env,
      workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
      inputEquals: expectedWorkflowInput,
    });

    const firstResponse = await refreshResources(env, expectedWorkflowInput);

    expect(firstResponse.status).toBe(202);
    const firstBody = RefreshIntegrationConnectionResourcesResponseSchema.parse(
      await firstResponse.json(),
    );
    expect(firstBody).toEqual({
      connectionId: "icn_internal_refresh_001",
      familyId: "github",
      kind: "repository",
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
    });

    const firstWorkflowRunCountAfter = await countQueuedControlPlaneWorkflows({
      env,
      workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
      inputEquals: expectedWorkflowInput,
    });
    expect(firstWorkflowRunCountAfter).toBe(workflowRunCountBefore + 1);

    const secondResponse = await refreshResources(env, expectedWorkflowInput);

    expect(secondResponse.status).toBe(202);
    RefreshIntegrationConnectionResourcesResponseSchema.parse(await secondResponse.json());
    await expect(
      countQueuedControlPlaneWorkflows({
        env,
        workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
        inputEquals: expectedWorkflowInput,
      }),
    ).resolves.toBe(firstWorkflowRunCountAfter);

    const persistedState =
      await env.controlPlaneDb.query.integrationConnectionResourceStates.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.connectionId, "icn_internal_refresh_001"), eq(table.kind, "repository")),
      });
    if (persistedState === undefined) {
      throw new Error("Expected persisted resource state.");
    }

    expect(persistedState.syncState).toBe(IntegrationConnectionResourceSyncStates.SYNCING);
  });

  it("rejects resource refresh requests without the internal service token", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      `${INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH}/refresh-resource`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: "org_test",
          connectionId: "icn_test",
          kind: "repository",
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("rejects malformed refresh requests", async ({ env }) => {
    const response = await refreshResources(env, {
      organizationId: "org_test",
      connectionId: "",
      kind: "repository",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });
});

async function refreshResources(env: IntegrationTestEnvironment, body: Record<string, unknown>) {
  return await env.controlPlaneApi.http.fetch(
    `${INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH}/refresh-resource`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: "integration-new-internal-service-token",
      },
      body: JSON.stringify(body),
    },
  );
}

async function seedConnection(env: IntegrationTestEnvironment): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.organizations).values({
    id: "org_internal_resource_refresh",
    name: "Internal Resource Refresh Org",
    slug: "internal-resource-refresh-org",
  });
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationTargets)
    .values({
      targetKey: "github_cloud_internal_refresh",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    })
    .onConflictDoNothing();
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
    id: "icn_internal_refresh_001",
    organizationId: "org_internal_resource_refresh",
    targetKey: "github_cloud_internal_refresh",
    displayName: "Internal GitHub Refresh",
    status: IntegrationConnectionStatuses.ACTIVE,
    createdAt: "2026-03-09T00:00:00.000Z",
    updatedAt: "2026-03-09T00:00:00.000Z",
  });
}
