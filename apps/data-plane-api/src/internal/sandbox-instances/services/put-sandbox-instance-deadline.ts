import {
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstanceDeadlineKind,
} from "@mistle/db/data-plane";
import { SpanStatusCode, trace } from "@mistle/telemetry";
import { HandleSandboxInstanceDeadlineWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { sql } from "drizzle-orm";

import { logger } from "../../../logger.js";
import type { AppRuntimeResources } from "../../../resources.js";

type PutSandboxInstanceDeadlineContext = {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstanceDeadlines">;
  openWorkflow: AppRuntimeResources["openWorkflow"];
};

type DataPlaneTransaction = Parameters<Parameters<DataPlaneDatabase["transaction"]>[0]>[0];
type DeadlineDatabase = DataPlaneDatabase | DataPlaneTransaction;
type DeadlineTables = Pick<DataPlaneTables, "sandboxInstanceDeadlines">;

export type PutSandboxInstanceDeadlineInput = {
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
  ownerLeaseId: string;
  dueAt: string;
};

export type PutSandboxInstanceDeadlineAcceptedResponse = {
  status: "accepted";
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
  generation: number;
  workflowRunId: string;
};

type PersistedSandboxInstanceDeadline = {
  ownerLeaseId: string;
  dueAt: string;
  generation: number;
  clearedAt: string | null;
};

// Keep same-key deadline writes serialized without blocking other deadline kinds.
export const SandboxInstanceDeadlineAdvisoryLockNamespace = 1_934_824_227;

function createDeadlineWorkflowIdempotencyKey(input: {
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
  ownerLeaseId: string;
  dueAt: string;
  generation: number;
}): string {
  return `deadline:${input.sandboxInstanceId}:${input.kind}:${input.ownerLeaseId}:${input.dueAt}:${String(input.generation)}`;
}

function canonicalizePersistedDueAt(dueAt: string): string {
  return new Date(dueAt).toISOString();
}

export function createSandboxInstanceDeadlineAdvisoryLockResourceKey(input: {
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
}): string {
  return `sandbox-instance-deadline:${input.sandboxInstanceId}:${input.kind}`;
}

function computeNextGeneration(input: {
  currentDeadline: PersistedSandboxInstanceDeadline | undefined;
  ownerLeaseId: string;
  dueAt: string;
}): number {
  if (input.currentDeadline === undefined) {
    return 1;
  }

  if (
    input.currentDeadline.clearedAt !== null ||
    input.currentDeadline.ownerLeaseId !== input.ownerLeaseId ||
    canonicalizePersistedDueAt(input.currentDeadline.dueAt) !== input.dueAt
  ) {
    return input.currentDeadline.generation + 1;
  }

  return input.currentDeadline.generation;
}

async function readCurrentSandboxInstanceDeadline(ctx: {
  db: DeadlineDatabase;
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
}): Promise<PersistedSandboxInstanceDeadline | undefined> {
  const deadline = await ctx.db.query.sandboxInstanceDeadlines.findFirst({
    columns: {
      ownerLeaseId: true,
      dueAt: true,
      generation: true,
      clearedAt: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxInstanceId, ctx.sandboxInstanceId), eq(table.kind, ctx.kind)),
  });

  return deadline;
}

async function persistSandboxInstanceDeadline(ctx: {
  db: DeadlineDatabase;
  tables: DeadlineTables;
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
  ownerLeaseId: string;
  dueAt: string;
  generation: number;
}): Promise<void> {
  const { sandboxInstanceDeadlines } = ctx.tables;

  await ctx.db
    .insert(sandboxInstanceDeadlines)
    .values({
      sandboxInstanceId: ctx.sandboxInstanceId,
      kind: ctx.kind,
      ownerLeaseId: ctx.ownerLeaseId,
      dueAt: ctx.dueAt,
      generation: ctx.generation,
      clearedAt: null,
    })
    .onConflictDoUpdate({
      target: [sandboxInstanceDeadlines.sandboxInstanceId, sandboxInstanceDeadlines.kind],
      set: {
        ownerLeaseId: ctx.ownerLeaseId,
        dueAt: ctx.dueAt,
        generation: ctx.generation,
        clearedAt: null,
        updatedAt: sql`now()`,
      },
    });
}

async function acquireSandboxInstanceDeadlineWriteLock(ctx: {
  db: DataPlaneTransaction;
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
}): Promise<void> {
  const resourceKey = createSandboxInstanceDeadlineAdvisoryLockResourceKey({
    sandboxInstanceId: ctx.sandboxInstanceId,
    kind: ctx.kind,
  });

  await ctx.db.execute(
    sql`select pg_advisory_xact_lock(${SandboxInstanceDeadlineAdvisoryLockNamespace}, hashtext(${resourceKey}))`,
  );
}

export async function putSandboxInstanceDeadline(
  ctx: PutSandboxInstanceDeadlineContext,
  input: PutSandboxInstanceDeadlineInput,
): Promise<PutSandboxInstanceDeadlineAcceptedResponse> {
  const generation = await ctx.db.transaction(async (tx) => {
    await acquireSandboxInstanceDeadlineWriteLock({
      db: tx,
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.kind,
    });

    const currentDeadline = await readCurrentSandboxInstanceDeadline({
      db: tx,
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.kind,
    });
    const nextGeneration = computeNextGeneration({
      currentDeadline,
      ownerLeaseId: input.ownerLeaseId,
      dueAt: input.dueAt,
    });

    await persistSandboxInstanceDeadline({
      db: tx,
      tables: ctx.tables,
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.kind,
      ownerLeaseId: input.ownerLeaseId,
      dueAt: input.dueAt,
      generation: nextGeneration,
    });

    return nextGeneration;
  });

  const workflowInput = {
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
    ownerLeaseId: input.ownerLeaseId,
    dueAt: input.dueAt,
    generation,
  };
  const workflowIdempotencyKey = createDeadlineWorkflowIdempotencyKey(workflowInput);
  const activeSpan = trace.getActiveSpan();
  activeSpan?.addEvent("sandbox_instance_deadline.workflow_enqueue_started", {
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    "mistle.sandbox.deadline.kind": input.kind,
    "mistle.sandbox.deadline.owner_lease_id": input.ownerLeaseId,
    "mistle.sandbox.deadline.due_at": input.dueAt,
    "mistle.sandbox.deadline.generation": generation,
    "mistle.workflow.name": HandleSandboxInstanceDeadlineWorkflowSpec.name,
    "mistle.workflow.idempotency_key": workflowIdempotencyKey,
  });

  let workflowRunHandle: Awaited<ReturnType<typeof ctx.openWorkflow.runWorkflow>>;
  try {
    workflowRunHandle = await ctx.openWorkflow.runWorkflow(
      HandleSandboxInstanceDeadlineWorkflowSpec,
      workflowInput,
      {
        availableAt: new Date(input.dueAt),
        idempotencyKey: workflowIdempotencyKey,
      },
    );
  } catch (error) {
    activeSpan?.recordException(error instanceof Error ? error : String(error));
    activeSpan?.setStatus({
      code: SpanStatusCode.ERROR,
      message: "Failed to enqueue sandbox instance deadline workflow.",
    });
    activeSpan?.addEvent("sandbox_instance_deadline.workflow_enqueue_failed", {
      "mistle.sandbox.instance_id": input.sandboxInstanceId,
      "mistle.sandbox.deadline.kind": input.kind,
      "mistle.sandbox.deadline.owner_lease_id": input.ownerLeaseId,
      "mistle.sandbox.deadline.due_at": input.dueAt,
      "mistle.sandbox.deadline.generation": generation,
      "mistle.workflow.name": HandleSandboxInstanceDeadlineWorkflowSpec.name,
      "mistle.workflow.idempotency_key": workflowIdempotencyKey,
    });
    logger.error(
      {
        err: error,
        sandboxInstanceId: input.sandboxInstanceId,
        kind: input.kind,
        ownerLeaseId: input.ownerLeaseId,
        dueAt: input.dueAt,
        generation,
        workflow: HandleSandboxInstanceDeadlineWorkflowSpec.name,
        workflowIdempotencyKey,
      },
      "Failed to enqueue sandbox instance deadline workflow after deadline write.",
    );
    throw error;
  }

  activeSpan?.addEvent("sandbox_instance_deadline.workflow_enqueue_completed", {
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    "mistle.sandbox.deadline.kind": input.kind,
    "mistle.sandbox.deadline.owner_lease_id": input.ownerLeaseId,
    "mistle.sandbox.deadline.due_at": input.dueAt,
    "mistle.sandbox.deadline.generation": generation,
    "mistle.workflow.name": HandleSandboxInstanceDeadlineWorkflowSpec.name,
    "mistle.workflow.idempotency_key": workflowIdempotencyKey,
    "mistle.workflow.run_id": workflowRunHandle.workflowRun.id,
  });
  logger.info(
    {
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.kind,
      ownerLeaseId: input.ownerLeaseId,
      dueAt: input.dueAt,
      generation,
      workflow: HandleSandboxInstanceDeadlineWorkflowSpec.name,
      workflowIdempotencyKey,
      workflowRunId: workflowRunHandle.workflowRun.id,
    },
    "Enqueued sandbox instance deadline workflow.",
  );

  return {
    status: "accepted",
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
    generation,
    workflowRunId: workflowRunHandle.workflowRun.id,
  };
}
