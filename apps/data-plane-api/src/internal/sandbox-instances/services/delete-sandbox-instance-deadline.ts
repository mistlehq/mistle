import {
  sandboxInstanceDeadlines,
  type DataPlaneDatabase,
  type SandboxInstanceDeadlineKind,
} from "@mistle/db/data-plane";
import { and, eq, isNull, sql } from "drizzle-orm";

type DeleteSandboxInstanceDeadlineContext = {
  db: DataPlaneDatabase;
};

export type DeleteSandboxInstanceDeadlineInput = {
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
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
        isNull(sandboxInstanceDeadlines.clearedAt),
      ),
    );

  return {
    status: "ok",
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
  };
}
