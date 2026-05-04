/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxInstancePurposes, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { typeid } from "typeid-js";
import { expect } from "vitest";

import { DATA_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal/index.js";

const InternalServiceToken = "integration-new-internal-service-token";

const it = createIntegrationTest({
  services: ["data-plane-api"],
});

it("lists sandbox instances from the requesting test environment", async ({ env }) => {
  const organizationId = "org_integration_new_data_plane_api";
  const sandboxInstanceId = typeid("sbi").toString();

  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: sandboxInstanceId,
    organizationId,
    sandboxProfileId: "sbp_integration_new_data_plane_api",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_new_data_plane_api",
    source: "system",
    purpose: SandboxInstancePurposes.SESSION,
  });
  const seededInstances = await env.dataPlaneDb.query.sandboxInstances.findMany({
    where: (table, { eq }) => eq(table.organizationId, organizationId),
  });

  expect(seededInstances).toHaveLength(1);

  const response = await env.dataPlaneApi.http.fetch(
    `/internal/sandbox/instances?organizationId=${encodeURIComponent(organizationId)}`,
    {
      headers: {
        [DATA_PLANE_INTERNAL_AUTH_HEADER]: InternalServiceToken,
      },
    },
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    totalResults: 1,
    items: [
      {
        id: sandboxInstanceId,
        sandboxProfileId: "sbp_integration_new_data_plane_api",
        status: "starting",
        startedBy: {
          kind: "system",
          id: "workflow_integration_new_data_plane_api",
        },
        source: "system",
      },
    ],
  });
});
