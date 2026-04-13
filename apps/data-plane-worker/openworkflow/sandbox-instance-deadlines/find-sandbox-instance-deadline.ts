import { type DataPlaneDatabase, type SandboxInstanceDeadlineKind } from "@mistle/db/data-plane";

export async function findSandboxInstanceDeadline(ctx: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
  kind: SandboxInstanceDeadlineKind;
}): Promise<
  | {
      sandboxInstanceId: string;
      kind: SandboxInstanceDeadlineKind;
      ownerLeaseId: string;
      dueAt: string;
      generation: number;
      clearedAt: string | null;
    }
  | undefined
> {
  const deadline = await ctx.db.query.sandboxInstanceDeadlines.findFirst({
    columns: {
      sandboxInstanceId: true,
      kind: true,
      ownerLeaseId: true,
      dueAt: true,
      generation: true,
      clearedAt: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxInstanceId, ctx.sandboxInstanceId), eq(table.kind, ctx.kind)),
  });

  if (deadline === undefined) {
    return undefined;
  }

  return {
    ...deadline,
    dueAt: new Date(deadline.dueAt).toISOString(),
  };
}
