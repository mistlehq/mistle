import {
  sandboxInstanceDeadlines,
  type DataPlaneDatabase,
  type SandboxInstanceDeadlineKind,
} from "@mistle/db/data-plane";
import { HandleSandboxInstanceDeadlineWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { sql } from "drizzle-orm";

import type { AppRuntimeResources } from "../../../resources.js";

type PutSandboxInstanceDeadlineContext = {
  db: DataPlaneDatabase;
  openWorkflow: AppRuntimeResources["openWorkflow"];
};

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
  db: DataPlaneDatabase;
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
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
  ownerLeaseId: string;
  dueAt: string;
  generation: number;
}): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await tx
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
  });
}

export async function putSandboxInstanceDeadline(
  ctx: PutSandboxInstanceDeadlineContext,
  input: PutSandboxInstanceDeadlineInput,
): Promise<PutSandboxInstanceDeadlineAcceptedResponse> {
  const currentDeadline = await readCurrentSandboxInstanceDeadline({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
  });
  const generation = computeNextGeneration({
    currentDeadline,
    ownerLeaseId: input.ownerLeaseId,
    dueAt: input.dueAt,
  });

  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    HandleSandboxInstanceDeadlineWorkflowSpec,
    {
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.kind,
      ownerLeaseId: input.ownerLeaseId,
      dueAt: input.dueAt,
      generation,
    },
    {
      availableAt: new Date(input.dueAt),
      idempotencyKey: createDeadlineWorkflowIdempotencyKey({
        sandboxInstanceId: input.sandboxInstanceId,
        kind: input.kind,
        ownerLeaseId: input.ownerLeaseId,
        dueAt: input.dueAt,
        generation,
      }),
    },
  );

  await persistSandboxInstanceDeadline({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
    ownerLeaseId: input.ownerLeaseId,
    dueAt: input.dueAt,
    generation,
  });

  return {
    status: "accepted",
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
    generation,
    workflowRunId: workflowRunHandle.workflowRun.id,
  };
}
