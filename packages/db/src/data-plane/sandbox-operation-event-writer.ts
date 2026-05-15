import { sql } from "drizzle-orm";

import { getDataPlaneDatabaseSchema, type DataPlaneDatabase } from "./database.js";
import type {
  SandboxLifecyclePhase,
  SandboxLifecycleStatus,
  SandboxOperationEventRecordKind,
  SandboxOperationEventSource,
  SandboxOperationKind,
  SandboxOperationTranscriptStream,
} from "./schema/index.js";

const SandboxOperationEventSequenceLockNamespace = 92_018;

type DataPlaneTransaction = Parameters<Parameters<DataPlaneDatabase["transaction"]>[0]>[0];
type DataPlaneOperationEventDatabase = DataPlaneDatabase | DataPlaneTransaction;

export type InsertSandboxOperationEventInput = {
  attributes: Record<string, unknown>;
  message: string;
  observedAt: string;
  operationId: string;
  operationKind: SandboxOperationKind;
  payloadBytes: Buffer | null;
  phase: SandboxLifecyclePhase | null;
  recordKind: SandboxOperationEventRecordKind;
  sandboxInstanceId: string;
  source: SandboxOperationEventSource;
  status: SandboxLifecycleStatus | null;
  stream: SandboxOperationTranscriptStream | null;
};

export async function insertSandboxOperationEvent(
  db: DataPlaneDatabase,
  input: InsertSandboxOperationEventInput,
): Promise<{ sequence: number }> {
  return db.transaction(async (tx) => {
    await acquireSandboxOperationEventSequenceLock(tx, {
      operationId: input.operationId,
      sandboxInstanceId: input.sandboxInstanceId,
    });

    const nextSequence = await readNextSandboxOperationSequence(tx, {
      operationId: input.operationId,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    const tables = getDataPlaneDatabaseSchema(tx);

    await tx.insert(tables.sandboxOperationEvents).values({
      sandboxInstanceId: input.sandboxInstanceId,
      operationKind: input.operationKind,
      operationId: input.operationId,
      sequence: nextSequence,
      recordKind: input.recordKind,
      observedAt: input.observedAt,
      source: input.source,
      phase: input.phase,
      status: input.status,
      stream: input.stream,
      message: input.message,
      payloadBytes: input.payloadBytes,
      attributes: input.attributes,
    });

    return {
      sequence: nextSequence,
    };
  });
}

async function acquireSandboxOperationEventSequenceLock(
  db: DataPlaneOperationEventDatabase,
  input: {
    operationId: string;
    sandboxInstanceId: string;
  },
): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(${SandboxOperationEventSequenceLockNamespace}, hashtext(${`${input.sandboxInstanceId}:${input.operationId}`}))`,
  );
}

async function readNextSandboxOperationSequence(
  db: DataPlaneOperationEventDatabase,
  input: {
    operationId: string;
    sandboxInstanceId: string;
  },
): Promise<number> {
  const lastEvent = await db.query.sandboxOperationEvents.findFirst({
    columns: {
      sequence: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxInstanceId, input.sandboxInstanceId),
        eq(table.operationId, input.operationId),
      ),
    orderBy: (table, { desc }) => [desc(table.sequence)],
  });

  return (lastEvent?.sequence ?? 0) + 1;
}
