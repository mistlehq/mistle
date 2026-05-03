/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { ScheduleTargetTypes } from "@mistle/db/control-plane";
import { createControlPlaneWorkflowNamespaceId } from "@mistle/db/test-environment";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemSleeper } from "@mistle/time";
import { ScheduleDispatchWorkflowName } from "@mistle/workflow-registry/control-plane";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal/index.js";
import { InternalDispatchSchedulesResponseSchema } from "../src/internal/schedules/dispatch-schedules/index.js";
import { INTERNAL_SCHEDULES_ROUTE_BASE_PATH } from "../src/internal/schedules/index.js";

type PersistedScheduleDispatchWorkflowRun = Readonly<{
  id: string;
  workflowName: string;
  idempotencyKey: string | null;
  input: unknown;
}>;

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const ScheduleDispatchWorkflowInputSchema = z
  .object({
    cutoffMinute: z.string().min(1),
  })
  .strict();

describe.concurrent("internal schedules dispatch integration", () => {
  it("rejects requests without the internal service token", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      `${INTERNAL_SCHEDULES_ROUTE_BASE_PATH}/dispatch`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("enqueues the top-level schedule dispatch workflow for authenticated callers", async ({
    env,
  }) => {
    const response = await requestScheduleDispatch(env);

    expect(response.status).toBe(202);
    const body = InternalDispatchSchedulesResponseSchema.parse(await response.json());
    expect(body.status).toBe("queued");
    expect(body.idempotencyKey).toBe(`schedule-dispatch:${body.cutoffMinute}`);
    expect(body.cutoffMinute).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/u);

    const workflowRuns = await listScheduleDispatchWorkflowRuns(env);
    expect(workflowRuns).toHaveLength(1);
    const workflowRun = readOnlyWorkflowRun(workflowRuns);

    expect(workflowRun.workflowName).toBe(ScheduleDispatchWorkflowName);
    expect(workflowRun.idempotencyKey).toBe(body.idempotencyKey);
    expect(ScheduleDispatchWorkflowInputSchema.parse(workflowRun.input)).toEqual({
      cutoffMinute: body.cutoffMinute,
    });
  });

  it("uses the same workflow idempotency key for duplicate calls in the same minute", async ({
    env,
  }) => {
    await waitForStableMinuteWindow();

    const firstResponse = await requestScheduleDispatch(env);
    const secondResponse = await requestScheduleDispatch(env);

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    const firstBody = InternalDispatchSchedulesResponseSchema.parse(await firstResponse.json());
    const secondBody = InternalDispatchSchedulesResponseSchema.parse(await secondResponse.json());

    expect(secondBody.cutoffMinute).toBe(firstBody.cutoffMinute);
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);

    const workflowRun = readOnlyWorkflowRun(await listScheduleDispatchWorkflowRuns(env));
    expect(workflowRun.idempotencyKey).toBe(firstBody.idempotencyKey);
  });

  it("deduplicates concurrent dispatch requests for the same minute", async ({ env }) => {
    await waitForStableMinuteWindow();

    const [firstResponse, secondResponse] = await Promise.all([
      requestScheduleDispatch(env),
      requestScheduleDispatch(env),
    ]);

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    const firstBody = InternalDispatchSchedulesResponseSchema.parse(await firstResponse.json());
    const secondBody = InternalDispatchSchedulesResponseSchema.parse(await secondResponse.json());

    expect(secondBody.cutoffMinute).toBe(firstBody.cutoffMinute);
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);

    const workflowRun = readOnlyWorkflowRun(await listScheduleDispatchWorkflowRuns(env));
    expect(workflowRun.idempotencyKey).toBe(firstBody.idempotencyKey);
  });

  it("does not mutate schedules or create scheduled actions in the HTTP request", async ({
    env,
  }) => {
    await env.controlPlaneDb.insert(env.controlPlaneTables.organizations).values({
      id: "org_internal_schedules_dispatch_no_inline",
      name: "Internal Schedules Dispatch No Inline",
      slug: "internal-schedules-dispatch-no-inline",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
      id: "sch_internal_schedules_dispatch_no_inline",
      organizationId: "org_internal_schedules_dispatch_no_inline",
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      name: "No inline dispatch",
      cronExpression: "* * * * *",
      timezone: "UTC",
      nextScheduledAt: "2026-04-28T10:15:00.000Z",
    });

    const beforeSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, "sch_internal_schedules_dispatch_no_inline"),
    });

    const response = await requestScheduleDispatch(env);
    expect(response.status).toBe(202);

    const afterSchedule = await env.controlPlaneDb.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, "sch_internal_schedules_dispatch_no_inline"),
    });
    expect(afterSchedule).toEqual(beforeSchedule);

    const persistedActions = await env.controlPlaneDb.query.scheduledActions.findMany({
      where: (table, { eq }) => eq(table.scheduleId, "sch_internal_schedules_dispatch_no_inline"),
    });
    expect(persistedActions).toHaveLength(0);
  });
});

async function requestScheduleDispatch(env: IntegrationTestEnvironment): Promise<Response> {
  return await env.controlPlaneApi.http.fetch(`${INTERNAL_SCHEDULES_ROUTE_BASE_PATH}/dispatch`, {
    method: "POST",
    headers: {
      [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: "integration-new-internal-service-token",
    },
  });
}

async function listScheduleDispatchWorkflowRuns(
  env: IntegrationTestEnvironment,
): Promise<ReadonlyArray<PersistedScheduleDispatchWorkflowRun>> {
  const namespaceId = createControlPlaneWorkflowNamespaceId(env.id);
  const result = await env.controlPlaneDb.execute(sql<{
    id: string;
    workflow_name: string;
    idempotency_key: string | null;
    input: unknown;
  }>`
    select
      wr.id,
      wr.workflow_name,
      wr.idempotency_key,
      wr.input
    from control_plane_openworkflow.workflow_runs wr
    where wr.namespace_id = ${namespaceId}
      and wr.workflow_name = ${ScheduleDispatchWorkflowName}
    order by wr.created_at asc
  `);

  return result.rows.map((row) => ({
    id: row.id,
    workflowName: row.workflow_name,
    idempotencyKey: row.idempotency_key,
    input: row.input,
  }));
}

function readOnlyWorkflowRun(
  workflowRuns: ReadonlyArray<PersistedScheduleDispatchWorkflowRun>,
): PersistedScheduleDispatchWorkflowRun {
  expect(workflowRuns).toHaveLength(1);
  const workflowRun = workflowRuns[0];
  if (workflowRun === undefined) {
    throw new Error("Expected schedule dispatch workflow run.");
  }

  return workflowRun;
}

async function waitForStableMinuteWindow(): Promise<void> {
  while (new Date().getUTCSeconds() > 55) {
    await systemSleeper.sleep(100);
  }
}
