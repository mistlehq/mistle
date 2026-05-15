import type { DataPlaneDatabase, DataPlaneTables } from "@mistle/db/data-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { and, asc, eq, gt } from "drizzle-orm";

import type { SandboxOperationEventsResponse } from "../schemas.js";

type ListSandboxOperationEventsContext = {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstances" | "sandboxOperationEvents">;
};

type ListSandboxOperationEventsInput = {
  sandboxInstanceId: string;
  organizationId: string;
  operationId: string;
  afterSequence?: number;
  limit?: number;
};

const DefaultLimit = 200;
const SandboxInstanceNotFoundErrorCode = "NOT_FOUND";

export async function listSandboxOperationEvents(
  ctx: ListSandboxOperationEventsContext,
  input: ListSandboxOperationEventsInput,
): Promise<SandboxOperationEventsResponse> {
  const { sandboxInstances, sandboxOperationEvents } = ctx.tables;
  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.sandboxInstanceId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (sandboxInstance === undefined) {
    throw new NotFoundError(
      SandboxInstanceNotFoundErrorCode,
      `Sandbox instance '${input.sandboxInstanceId}' was not found.`,
    );
  }

  const events = await ctx.db
    .select({
      id: sandboxOperationEvents.id,
      sandboxInstanceId: sandboxOperationEvents.sandboxInstanceId,
      operationKind: sandboxOperationEvents.operationKind,
      operationId: sandboxOperationEvents.operationId,
      sequence: sandboxOperationEvents.sequence,
      recordKind: sandboxOperationEvents.recordKind,
      observedAt: sandboxOperationEvents.observedAt,
      source: sandboxOperationEvents.source,
      phase: sandboxOperationEvents.phase,
      status: sandboxOperationEvents.status,
      stream: sandboxOperationEvents.stream,
      message: sandboxOperationEvents.message,
      payloadBytes: sandboxOperationEvents.payloadBytes,
      attributes: sandboxOperationEvents.attributes,
      createdAt: sandboxOperationEvents.createdAt,
    })
    .from(sandboxOperationEvents)
    .innerJoin(sandboxInstances, eq(sandboxInstances.id, sandboxOperationEvents.sandboxInstanceId))
    .where(
      and(
        eq(sandboxOperationEvents.sandboxInstanceId, input.sandboxInstanceId),
        eq(sandboxOperationEvents.operationId, input.operationId),
        eq(sandboxInstances.organizationId, input.organizationId),
        input.afterSequence === undefined
          ? undefined
          : gt(sandboxOperationEvents.sequence, input.afterSequence),
      ),
    )
    .orderBy(asc(sandboxOperationEvents.sequence))
    .limit(input.limit ?? DefaultLimit);

  return {
    events: events.map((event) => ({
      id: event.id,
      sandboxInstanceId: event.sandboxInstanceId,
      operationKind: event.operationKind,
      operationId: event.operationId,
      sequence: event.sequence,
      recordKind: event.recordKind,
      observedAt: event.observedAt,
      source: event.source,
      phase: event.phase,
      status: event.status,
      stream: event.stream,
      message: event.message,
      payloadBase64: event.payloadBytes === null ? null : event.payloadBytes.toString("base64"),
      attributes: event.attributes,
      createdAt: event.createdAt,
    })),
  };
}
