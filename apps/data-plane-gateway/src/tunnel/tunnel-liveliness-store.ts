import { sandboxInstances, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

async function assertSandboxInstanceUpdated(input: {
  sandboxInstanceId: string;
  updatedRows: Array<{ id: string }>;
}): Promise<void> {
  if (input.updatedRows[0] !== undefined) {
    return;
  }

  throw new Error(
    `Sandbox instance '${input.sandboxInstanceId}' was not found while updating tunnel liveliness.`,
  );
}

export async function markSandboxTunnelConnected(input: {
  activeTunnelLeaseId: string;
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<void> {
  const updatedRows = await input.db
    .update(sandboxInstances)
    .set({
      activeTunnelLeaseId: input.activeTunnelLeaseId,
      tunnelConnectedAt: sql`now()`,
      lastTunnelSeenAt: sql`now()`,
      tunnelDisconnectedAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(sandboxInstances.id, input.sandboxInstanceId))
    .returning({
      id: sandboxInstances.id,
    });

  await assertSandboxInstanceUpdated({
    sandboxInstanceId: input.sandboxInstanceId,
    updatedRows,
  });
}

export async function markSandboxTunnelSeen(input: {
  activeTunnelLeaseId: string;
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<boolean> {
  const updatedRows = await input.db
    .update(sandboxInstances)
    .set({
      lastTunnelSeenAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.sandboxInstanceId),
        eq(sandboxInstances.activeTunnelLeaseId, input.activeTunnelLeaseId),
      ),
    )
    .returning({
      id: sandboxInstances.id,
    });

  return updatedRows[0] !== undefined;
}

export async function markSandboxTunnelDisconnected(input: {
  activeTunnelLeaseId: string;
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<boolean> {
  const updatedRows = await input.db
    .update(sandboxInstances)
    .set({
      tunnelDisconnectedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.sandboxInstanceId),
        eq(sandboxInstances.activeTunnelLeaseId, input.activeTunnelLeaseId),
      ),
    )
    .returning({
      id: sandboxInstances.id,
    });

  return updatedRows[0] !== undefined;
}
