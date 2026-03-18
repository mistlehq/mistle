import {
  SandboxInstanceStatuses,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

export async function persistSandboxInstanceRuntimeAttachment(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: {
    sandboxInstanceId: string;
    providerRuntimeId: string;
  },
): Promise<void> {
  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      providerRuntimeId: input.providerRuntimeId,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.sandboxInstanceId),
        eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
      ),
    )
    .returning({
      id: sandboxInstances.id,
    });

  if (updatedRows[0] === undefined) {
    throw new Error(
      "Failed to persist provider runtime id while sandbox instance was still starting.",
    );
  }
}
