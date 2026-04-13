import {
  SandboxInstanceDeadlineKinds,
  sandboxInstanceDeadlines,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

type DeadlineWritableDatabase = Pick<DataPlaneDatabase, "update">;

export async function clearSandboxInstanceDeadlines(ctx: {
  db: DeadlineWritableDatabase;
  sandboxInstanceId: string;
}): Promise<void> {
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
