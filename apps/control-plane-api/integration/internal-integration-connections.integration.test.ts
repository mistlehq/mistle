import {
  integrationConnections,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
  integrationTargets,
  organizations,
} from "@mistle/db/control-plane";
import { SyncIntegrationConnectionResourcesWorkflowSpec } from "@mistle/workflows/control-plane";
import { describe, expect } from "vitest";

import { RefreshIntegrationConnectionResourcesResponseSchema } from "../src/integration-connections/contracts.js";
import { INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "../src/internal-integration-connections/index.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal-integration-credentials/index.js";
import { countControlPlaneWorkflowRuns } from "./helpers/workflow-runs.js";
import { it } from "./test-context.js";

describe("internal integration connections", () => {
  it("requests resource refresh through the internal route and reuses the existing single-flight service", async ({
    fixture,
  }) => {
    const organizationId = "org_internal_resource_refresh";

    await fixture.db.insert(organizations).values({
      id: organizationId,
      name: "Internal Resource Refresh Org",
      slug: "internal-resource-refresh-org",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "github_cloud",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          base_url: "https://github.com",
        },
      })
      .onConflictDoNothing();

    await fixture.db.insert(integrationConnections).values({
      id: "icn_internal_refresh_001",
      organizationId,
      targetKey: "github_cloud",
      displayName: "Internal GitHub Refresh",
      status: IntegrationConnectionStatuses.ACTIVE,
      createdAt: "2026-03-09T00:00:00.000Z",
      updatedAt: "2026-03-09T00:00:00.000Z",
    });

    const workflowRunCountBefore = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
      inputEquals: {
        organizationId,
        connectionId: "icn_internal_refresh_001",
        kind: "repository",
      },
    });

    const firstResponse = await fixture.request(
      `${INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH}/refresh-resource`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId,
          connectionId: "icn_internal_refresh_001",
          kind: "repository",
        }),
      },
    );

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

    const firstWorkflowRunCountAfter = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
      inputEquals: {
        organizationId,
        connectionId: "icn_internal_refresh_001",
        kind: "repository",
      },
    });
    expect(firstWorkflowRunCountAfter).toBe(workflowRunCountBefore + 1);

    const secondResponse = await fixture.request(
      `${INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH}/refresh-resource`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId,
          connectionId: "icn_internal_refresh_001",
          kind: "repository",
        }),
      },
    );

    expect(secondResponse.status).toBe(202);
    RefreshIntegrationConnectionResourcesResponseSchema.parse(await secondResponse.json());

    const secondWorkflowRunCountAfter = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: SyncIntegrationConnectionResourcesWorkflowSpec.name,
      inputEquals: {
        organizationId,
        connectionId: "icn_internal_refresh_001",
        kind: "repository",
      },
    });
    expect(secondWorkflowRunCountAfter).toBe(firstWorkflowRunCountAfter);

    const persistedState = await fixture.db.query.integrationConnectionResourceStates.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.connectionId, "icn_internal_refresh_001"), eq(table.kind, "repository")),
    });
    expect(persistedState).toBeDefined();
    if (persistedState === undefined) {
      throw new Error("Expected persisted resource state.");
    }

    expect(persistedState.syncState).toBe(IntegrationConnectionResourceSyncStates.SYNCING);
  });

  it("rejects resource refresh requests without the internal service token", async ({
    fixture,
  }) => {
    const response = await fixture.request(
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

  it("rejects malformed refresh requests", async ({ fixture }) => {
    const response = await fixture.request(
      `${INTERNAL_INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH}/refresh-resource`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: "org_test",
          connectionId: "",
          kind: "repository",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        name: "ZodError",
      },
    });
  });
});
