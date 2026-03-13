import { sandboxInstances, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { eq, sql } from "drizzle-orm";

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
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<void> {
  const updatedRows = await input.db
    .update(sandboxInstances)
    .set({
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
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<void> {
  const updatedRows = await input.db
    .update(sandboxInstances)
    .set({
      lastTunnelSeenAt: sql`now()`,
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

export async function markSandboxTunnelDisconnected(input: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<void> {
  const updatedRows = await input.db
    .update(sandboxInstances)
    .set({
      tunnelDisconnectedAt: sql`now()`,
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
