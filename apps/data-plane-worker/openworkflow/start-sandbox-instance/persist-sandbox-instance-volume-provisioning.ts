import {
  SandboxInstanceStatuses,
  sandboxInstances,
  type DataPlaneDatabase,
  type SandboxInstanceVolumeMode,
  type SandboxInstanceVolumeProvider,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

export async function persistSandboxInstanceVolumeProvisioning(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: {
    sandboxInstanceId: string;
    instanceVolumeProvider: SandboxInstanceVolumeProvider;
    instanceVolumeId: string;
    instanceVolumeMode: SandboxInstanceVolumeMode;
  },
): Promise<void> {
  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      instanceVolumeProvider: input.instanceVolumeProvider,
      instanceVolumeId: input.instanceVolumeId,
      instanceVolumeMode: input.instanceVolumeMode,
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
      "Failed to persist instance volume metadata while sandbox instance was still starting.",
    );
  }
}
