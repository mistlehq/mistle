import {
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstanceDeadlineKind,
} from "@mistle/db/data-plane";
import { and, eq, isNull, sql } from "drizzle-orm";

type DeleteSandboxInstanceDeadlineContext = {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstanceDeadlines">;
};

export type DeleteSandboxInstanceDeadlineInput = {
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
  ownerLeaseId: string;
};

export type DeleteSandboxInstanceDeadlineOkResponse = {
  status: "ok";
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
};

export async function deleteSandboxInstanceDeadline(
  ctx: DeleteSandboxInstanceDeadlineContext,
  input: DeleteSandboxInstanceDeadlineInput,
): Promise<DeleteSandboxInstanceDeadlineOkResponse> {
  const { sandboxInstanceDeadlines } = ctx.tables;

  await ctx.db
    .update(sandboxInstanceDeadlines)
    .set({
      clearedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstanceDeadlines.sandboxInstanceId, input.sandboxInstanceId),
        eq(sandboxInstanceDeadlines.kind, input.kind),
        eq(sandboxInstanceDeadlines.ownerLeaseId, input.ownerLeaseId),
        isNull(sandboxInstanceDeadlines.clearedAt),
      ),
    );

  return {
    status: "ok",
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
  };
}
