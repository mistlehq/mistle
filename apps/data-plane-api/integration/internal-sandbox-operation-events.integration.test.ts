/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  createDataPlaneSandboxInstancesClient,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-internal-client";
import { SandboxInstanceStatuses, type DataPlaneTables } from "@mistle/db/data-plane";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { expect } from "vitest";

import { SandboxOperationEventsResponseSchema } from "../src/internal/sandbox-instances/schemas.js";

const it = createIntegrationTest({
  services: ["data-plane-api"],
});

it("lists lifecycle and transcript records for one sandbox operation in sequence order", async ({
  env,
}) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_dp_operation_events_001",
      organizationId: "org_dp_operation_events_001",
      sandboxProfileId: "sbp_dp_operation_events_001",
    }),
  );
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxOperationEvents).values([
    operationEventRow({
      id: "soe_dp_operation_events_002",
      sandboxInstanceId: "sbi_dp_operation_events_001",
      operationId: "op_dp_operation_events_001",
      sequence: 2,
      recordKind: "transcript",
      phase: "runtime_plan",
      status: null,
      stream: "stdout",
      message: "",
      payloadBytes: Buffer.from("installed package", "utf8"),
    }),
    operationEventRow({
      id: "soe_dp_operation_events_other",
      sandboxInstanceId: "sbi_dp_operation_events_001",
      operationId: "op_dp_operation_events_other",
      sequence: 0,
      message: "different operation",
    }),
    operationEventRow({
      id: "soe_dp_operation_events_001",
      sandboxInstanceId: "sbi_dp_operation_events_001",
      operationId: "op_dp_operation_events_001",
      sequence: 1,
      message: "runtime plan started",
      attributes: {
        commandIndex: "0",
      },
    }),
  ]);
  const persistedEvents = await env.dataPlaneDb
    .select({
      id: env.dataPlaneTables.sandboxOperationEvents.id,
    })
    .from(env.dataPlaneTables.sandboxOperationEvents);

  expect(persistedEvents.map((event) => event.id).sort()).toEqual([
    "soe_dp_operation_events_001",
    "soe_dp_operation_events_002",
    "soe_dp_operation_events_other",
  ]);

  const response = await clientFor(env).listSandboxOperationEvents({
    organizationId: "org_dp_operation_events_001",
    sandboxInstanceId: "sbi_dp_operation_events_001",
    operationId: "op_dp_operation_events_001",
  });

  expect(response.events).toHaveLength(2);
  expect(response.events.map((event) => event.sequence)).toEqual([1, 2]);
  expect(response.events[0]).toMatchObject({
    id: "soe_dp_operation_events_001",
    sandboxInstanceId: "sbi_dp_operation_events_001",
    operationKind: "start",
    operationId: "op_dp_operation_events_001",
    recordKind: "lifecycle",
    source: "sandboxd",
    phase: "runtime_plan",
    status: "started",
    stream: null,
    message: "runtime plan started",
    payloadBase64: null,
    attributes: {
      commandIndex: "0",
    },
  });
  expect(response.events[1]).toMatchObject({
    id: "soe_dp_operation_events_002",
    recordKind: "transcript",
    phase: "runtime_plan",
    status: null,
    stream: "stdout",
    message: "",
    payloadBase64: "aW5zdGFsbGVkIHBhY2thZ2U=",
  });
});

it("uses afterSequence as the operation polling cursor", async ({ env }) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_dp_operation_events_after",
      organizationId: "org_dp_operation_events_after",
      sandboxProfileId: "sbp_dp_operation_events_after",
    }),
  );
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxOperationEvents).values([
    operationEventRow({
      id: "soe_dp_operation_events_after_001",
      sandboxInstanceId: "sbi_dp_operation_events_after",
      operationId: "op_dp_operation_events_after",
      sequence: 1,
    }),
    operationEventRow({
      id: "soe_dp_operation_events_after_002",
      sandboxInstanceId: "sbi_dp_operation_events_after",
      operationId: "op_dp_operation_events_after",
      sequence: 2,
    }),
  ]);

  const response = await clientFor(env).listSandboxOperationEvents({
    organizationId: "org_dp_operation_events_after",
    sandboxInstanceId: "sbi_dp_operation_events_after",
    operationId: "op_dp_operation_events_after",
    afterSequence: 1,
  });

  expect(response.events.map((event) => event.id)).toEqual(["soe_dp_operation_events_after_002"]);
});

it("returns an empty event list when the operation has no persisted data", async ({ env }) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_dp_operation_events_empty",
      organizationId: "org_dp_operation_events_empty",
      sandboxProfileId: "sbp_dp_operation_events_empty",
    }),
  );

  const response = await clientFor(env).listSandboxOperationEvents({
    organizationId: "org_dp_operation_events_empty",
    sandboxInstanceId: "sbi_dp_operation_events_empty",
    operationId: "op_dp_operation_events_missing",
  });

  expect(response).toEqual({ events: [] });
});

it("lists stop lifecycle events", async ({ env }) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_dp_operation_events_stop",
      organizationId: "org_dp_operation_events_stop",
      sandboxProfileId: "sbp_dp_operation_events_stop",
    }),
  );
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxOperationEvents).values(
    operationEventRow({
      id: "soe_dp_operation_events_stop",
      sandboxInstanceId: "sbi_dp_operation_events_stop",
      operationId: "op_dp_operation_events_stop",
      operationKind: "stop",
      phase: "stop",
      sequence: 1,
      source: "worker",
      message: "Sandbox stop requested.",
    }),
  );

  const response = await clientFor(env).listSandboxOperationEvents({
    organizationId: "org_dp_operation_events_stop",
    sandboxInstanceId: "sbi_dp_operation_events_stop",
    operationId: "op_dp_operation_events_stop",
  });

  expect(response.events).toHaveLength(1);
  expect(response.events[0]).toMatchObject({
    operationKind: "stop",
    phase: "stop",
    source: "worker",
    message: "Sandbox stop requested.",
    payloadBase64: null,
  });
});

it("exposes the operation event route through the internal HTTP API", async ({ env }) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_dp_operation_events_http",
      organizationId: "org_dp_operation_events_http",
      sandboxProfileId: "sbp_dp_operation_events_http",
    }),
  );

  const response = await env.dataPlaneApi.http.fetch(
    "/internal/sandbox/instances/sbi_dp_operation_events_http/operation-events?organizationId=org_dp_operation_events_http&operationId=op_dp_operation_events_http",
    {
      headers: {
        "x-mistle-service-token": "integration-new-internal-service-token",
        [TestEnvironmentIdHeader]: env.id,
      },
    },
  );

  expect(response.status).toBe(200);
  expect(SandboxOperationEventsResponseSchema.parse(await response.json())).toEqual({
    events: [],
  });
});

function clientFor(env: IntegrationTestEnvironment): DataPlaneSandboxInstancesClient {
  return createDataPlaneSandboxInstancesClient({
    baseUrl: env.dataPlaneApi.hostBaseUrl,
    serviceToken: "integration-new-internal-service-token",
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

type SandboxInstanceRow = DataPlaneTables["sandboxInstances"]["$inferInsert"];
type SandboxOperationEventRow = DataPlaneTables["sandboxOperationEvents"]["$inferInsert"];

function sandboxInstanceRow(
  input: Partial<SandboxInstanceRow> & {
    id: string;
    organizationId: string;
    sandboxProfileId: string;
  },
): SandboxInstanceRow {
  return {
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.id}`,
    status: SandboxInstanceStatuses.PENDING,
    startedByKind: "user",
    startedById: "usr_dp_operation_events",
    source: "dashboard",
    ...input,
  };
}

function operationEventRow(
  input: Partial<SandboxOperationEventRow> & {
    id: string;
    sandboxInstanceId: string;
    operationId: string;
    sequence: number;
  },
): SandboxOperationEventRow {
  return {
    operationKind: "start",
    recordKind: "lifecycle",
    observedAt: "2026-05-13T00:00:00.000Z",
    source: "sandboxd",
    phase: "runtime_plan",
    status: "started",
    stream: null,
    message: "operation event",
    payloadBytes: null,
    attributes: {},
    ...input,
  };
}
