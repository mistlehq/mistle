/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { SandboxOperationEventsResponseSchema } from "../src/sandbox-instances/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("sandbox operation events integration", () => {
  it("proxies dashboard operation event reads through control-plane API", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-operation-events@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_operation_events_001",
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxOperationEvents).values([
      operationEventRow({
        id: "soe_cp_operation_events_002",
        sandboxInstanceId: "sbi_cp_operation_events_001",
        operationId: "op_cp_operation_events_001",
        sequence: 2,
        recordKind: "transcript",
        phase: "setup_script",
        status: null,
        stream: "stderr",
        message: "",
        payloadBytes: Buffer.from("retrying download", "utf8"),
      }),
      operationEventRow({
        id: "soe_cp_operation_events_001",
        sandboxInstanceId: "sbi_cp_operation_events_001",
        operationId: "op_cp_operation_events_001",
        sequence: 1,
        phase: "setup_script",
        status: "started",
        stream: null,
        message: "setup script started",
      }),
    ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_operation_events_001/operation-events?operationId=op_cp_operation_events_001&afterSequence=1",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = SandboxOperationEventsResponseSchema.parse(await response.json());

    expect(body.events.map((event) => event.id)).toEqual(["soe_cp_operation_events_002"]);
    expect(body.events[0]).toMatchObject({
      sandboxInstanceId: "sbi_cp_operation_events_001",
      operationKind: "start",
      operationId: "op_cp_operation_events_001",
      sequence: 2,
      recordKind: "transcript",
      source: "sandboxd",
      phase: "setup_script",
      status: null,
      stream: "stderr",
      message: "",
      payloadBase64: "cmV0cnlpbmcgZG93bmxvYWQ=",
    });
  });

  it("proxies snapshot sandbox operation event reads without exposing snapshot instances", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-operation-events-snapshot@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      purpose: SandboxInstancePurposes.SNAPSHOT,
      sandboxInstanceId: "sbi_cp_operation_events_snapshot",
      source: SandboxInstanceSources.SYSTEM,
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxOperationEvents).values([
      operationEventRow({
        id: "soe_cp_operation_events_snapshot_001",
        sandboxInstanceId: "sbi_cp_operation_events_snapshot",
        operationId: "ssj_cp_operation_events_snapshot",
        operationKind: "snapshot",
        sequence: 1,
        phase: "snapshot",
        status: "started",
        stream: null,
        message: "snapshot image capture started",
      }),
    ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_operation_events_snapshot/operation-events?operationId=ssj_cp_operation_events_snapshot",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = SandboxOperationEventsResponseSchema.parse(await response.json());

    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      sandboxInstanceId: "sbi_cp_operation_events_snapshot",
      operationKind: "snapshot",
      operationId: "ssj_cp_operation_events_snapshot",
      phase: "snapshot",
      status: "started",
      message: "snapshot image capture started",
    });
  });

  it("proxies stop sandbox operation event reads", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-operation-events-stop@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_operation_events_stop",
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxOperationEvents).values([
      operationEventRow({
        id: "soe_cp_operation_events_stop_001",
        sandboxInstanceId: "sbi_cp_operation_events_stop",
        operationId: "op_cp_operation_events_stop",
        operationKind: "stop",
        sequence: 1,
        phase: "stop",
        source: "worker",
        status: "started",
        stream: null,
        message: "Sandbox stop requested.",
      }),
    ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_operation_events_stop/operation-events?operationId=op_cp_operation_events_stop",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = SandboxOperationEventsResponseSchema.parse(await response.json());

    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      sandboxInstanceId: "sbi_cp_operation_events_stop",
      operationKind: "stop",
      operationId: "op_cp_operation_events_stop",
      phase: "stop",
      source: "worker",
      status: "started",
      message: "Sandbox stop requested.",
    });
  });

  it("returns not found before proxying when the sandbox is outside the active organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-operation-events-not-found@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: "org_cp_operation_events_other",
      sandboxInstanceId: "sbi_cp_operation_events_other",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_operation_events_other/operation-events?operationId=op_cp_operation_events_other",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "INSTANCE_NOT_FOUND",
    });
  });
});

type SandboxInstanceRow = DataPlaneTables["sandboxInstances"]["$inferInsert"];
type SandboxOperationEventRow = DataPlaneTables["sandboxOperationEvents"]["$inferInsert"];

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    purpose?: SandboxInstanceRow["purpose"];
    sandboxInstanceId: string;
    source?: SandboxInstanceRow["source"];
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: `sbp_${input.sandboxInstanceId}`,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.PENDING,
    startedByKind: "user",
    startedById: "usr_cp_operation_events",
    source: input.source ?? SandboxInstanceSources.DASHBOARD,
    purpose: input.purpose ?? SandboxInstancePurposes.SESSION,
  } satisfies SandboxInstanceRow);
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
