import { organizations, schedules, ScheduleTargetTypes } from "@mistle/db/control-plane";
import { systemSleeper } from "@mistle/time";
import { ScheduleDispatchWorkflowName } from "@mistle/workflow-registry/control-plane";
import { Pool } from "pg";
import { describe, expect } from "vitest";
import { z } from "zod";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal/index.js";
import { InternalDispatchSchedulesResponseSchema } from "../src/internal/schedules/dispatch-schedules/index.js";
import { INTERNAL_SCHEDULES_ROUTE_BASE_PATH } from "../src/internal/schedules/index.js";
import { ControlPlaneOpenWorkflowSchema } from "../src/openworkflow.js";
import { it } from "./test-context.js";

type PersistedScheduleDispatchWorkflowRun = Readonly<{
  id: string;
  workflowName: string;
  idempotencyKey: string | null;
  input: unknown;
}>;

const ScheduleDispatchWorkflowInputSchema = z
  .object({
    cutoffMinute: z.string().min(1),
  })
  .strict();

async function listScheduleDispatchWorkflowRuns(input: {
  databaseUrl: string;
  namespaceId: string;
}): Promise<ReadonlyArray<PersistedScheduleDispatchWorkflowRun>> {
  const pool = new Pool({
    connectionString: input.databaseUrl,
  });

  try {
    const result = await pool.query<{
      id: string;
      workflow_name: string;
      idempotency_key: string | null;
      input: unknown;
    }>(
      `
        select
          wr.id,
          wr.workflow_name,
          wr.idempotency_key,
          wr.input
        from ${ControlPlaneOpenWorkflowSchema}.workflow_runs wr
        where wr.namespace_id = $1
          and wr.workflow_name = $2
        order by wr.created_at asc
      `,
      [input.namespaceId, ScheduleDispatchWorkflowName],
    );

    return result.rows.map((row) => ({
      id: row.id,
      workflowName: row.workflow_name,
      idempotencyKey: row.idempotency_key,
      input: row.input,
    }));
  } finally {
    await pool.end();
  }
}

function expectScheduleDispatchWorkflowInput(input: unknown): { cutoffMinute: string } {
  return ScheduleDispatchWorkflowInputSchema.parse(input);
}

async function waitForStableMinuteWindow(): Promise<void> {
  while (new Date().getUTCSeconds() > 55) {
    await systemSleeper.sleep(100);
  }
}

async function requestScheduleDispatch(input: {
  fixture: {
    internalAuthServiceToken: string;
    request: (path: string, init?: RequestInit) => Response | Promise<Response>;
  };
}): Promise<Response> {
  return input.fixture.request(`${INTERNAL_SCHEDULES_ROUTE_BASE_PATH}/dispatch`, {
    method: "POST",
    headers: {
      [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: input.fixture.internalAuthServiceToken,
    },
  });
}

describe("internal schedules dispatch", () => {
  it("rejects requests without the internal service token", async ({ fixture }) => {
    const response = await fixture.request(`${INTERNAL_SCHEDULES_ROUTE_BASE_PATH}/dispatch`, {
      method: "POST",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("enqueues the top-level schedule dispatch workflow for authenticated callers", async ({
    fixture,
  }) => {
    const response = await requestScheduleDispatch({ fixture });

    expect(response.status).toBe(202);
    const body = InternalDispatchSchedulesResponseSchema.parse(await response.json());
    expect(body.status).toBe("queued");
    expect(body.idempotencyKey).toBe(`schedule-dispatch:${body.cutoffMinute}`);
    expect(body.cutoffMinute).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/u);

    const workflowRuns = await listScheduleDispatchWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      namespaceId: fixture.config.workflow.namespaceId,
    });
    expect(workflowRuns).toHaveLength(1);
    const workflowRun = workflowRuns[0];
    if (workflowRun === undefined) {
      throw new Error("Expected schedule dispatch workflow run.");
    }

    expect(workflowRun.workflowName).toBe(ScheduleDispatchWorkflowName);
    expect(workflowRun.idempotencyKey).toBe(body.idempotencyKey);
    expect(expectScheduleDispatchWorkflowInput(workflowRun.input)).toEqual({
      cutoffMinute: body.cutoffMinute,
    });
  });

  it("uses the same workflow idempotency key for duplicate calls in the same minute", async ({
    fixture,
  }) => {
    await waitForStableMinuteWindow();

    const firstResponse = await requestScheduleDispatch({ fixture });
    const secondResponse = await requestScheduleDispatch({ fixture });

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    const firstBody = InternalDispatchSchedulesResponseSchema.parse(await firstResponse.json());
    const secondBody = InternalDispatchSchedulesResponseSchema.parse(await secondResponse.json());

    expect(secondBody.cutoffMinute).toBe(firstBody.cutoffMinute);
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);

    const workflowRuns = await listScheduleDispatchWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      namespaceId: fixture.config.workflow.namespaceId,
    });
    expect(workflowRuns).toHaveLength(1);
    const workflowRun = workflowRuns[0];
    if (workflowRun === undefined) {
      throw new Error("Expected schedule dispatch workflow run.");
    }
    expect(workflowRun.idempotencyKey).toBe(firstBody.idempotencyKey);
  });

  it("deduplicates concurrent dispatch requests for the same minute", async ({ fixture }) => {
    await waitForStableMinuteWindow();

    const [firstResponse, secondResponse] = await Promise.all([
      requestScheduleDispatch({ fixture }),
      requestScheduleDispatch({ fixture }),
    ]);

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    const firstBody = InternalDispatchSchedulesResponseSchema.parse(await firstResponse.json());
    const secondBody = InternalDispatchSchedulesResponseSchema.parse(await secondResponse.json());

    expect(secondBody.cutoffMinute).toBe(firstBody.cutoffMinute);
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);

    const workflowRuns = await listScheduleDispatchWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      namespaceId: fixture.config.workflow.namespaceId,
    });
    expect(workflowRuns).toHaveLength(1);
    const workflowRun = workflowRuns[0];
    if (workflowRun === undefined) {
      throw new Error("Expected schedule dispatch workflow run.");
    }
    expect(workflowRun.idempotencyKey).toBe(firstBody.idempotencyKey);
  });

  it("does not mutate schedules or create scheduled actions in the HTTP request", async ({
    fixture,
  }) => {
    await fixture.db.insert(organizations).values({
      id: "org_internal_schedules_dispatch_no_inline",
      name: "Internal Schedules Dispatch No Inline",
      slug: "internal-schedules-dispatch-no-inline",
    });
    await fixture.db.insert(schedules).values({
      id: "sch_internal_schedules_dispatch_no_inline",
      organizationId: "org_internal_schedules_dispatch_no_inline",
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      name: "No inline dispatch",
      cronExpression: "* * * * *",
      timezone: "UTC",
      nextScheduledAt: "2026-04-28T10:15:00.000Z",
    });

    const beforeSchedule = await fixture.db.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, "sch_internal_schedules_dispatch_no_inline"),
    });

    const response = await requestScheduleDispatch({ fixture });
    expect(response.status).toBe(202);

    const afterSchedule = await fixture.db.query.schedules.findFirst({
      where: (table, { eq }) => eq(table.id, "sch_internal_schedules_dispatch_no_inline"),
    });
    expect(afterSchedule).toEqual(beforeSchedule);

    const persistedActions = await fixture.db.query.scheduledActions.findMany({
      where: (table, { eq }) => eq(table.scheduleId, "sch_internal_schedules_dispatch_no_inline"),
    });
    expect(persistedActions).toHaveLength(0);
  });
});
