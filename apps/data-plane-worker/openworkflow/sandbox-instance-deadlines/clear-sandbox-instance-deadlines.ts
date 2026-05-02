import {
  SandboxInstanceDeadlineKinds,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

type DeadlineWritableDatabase = Pick<DataPlaneDatabase, "update">;

export async function clearSandboxInstanceDeadlines(ctx: {
  db: DeadlineWritableDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstanceDeadlines">;
  sandboxInstanceId: string;
}): Promise<void> {
  const { sandboxInstanceDeadlines } = ctx.tables;
  await ctx.db
    .update(sandboxInstanceDeadlines)
    .set({
      clearedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstanceDeadlines.sandboxInstanceId, ctx.sandboxInstanceId),
        inArray(sandboxInstanceDeadlines.kind, [
          SandboxInstanceDeadlineKinds.IDLE,
          SandboxInstanceDeadlineKinds.DISCONNECT,
        ]),
        isNull(sandboxInstanceDeadlines.clearedAt),
      ),
    );
}
