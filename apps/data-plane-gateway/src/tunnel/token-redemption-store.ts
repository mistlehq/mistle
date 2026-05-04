import type { DataPlaneDatabase, DataPlaneTables } from "@mistle/db/data-plane";

export async function recordSandboxTunnelTokenRedemption(input: {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxTunnelTokenRedemptions">;
  tokenJti: string;
}): Promise<boolean> {
  const { sandboxTunnelTokenRedemptions } = input.tables;
  const insertedRows = await input.db
    .insert(sandboxTunnelTokenRedemptions)
    .values({
      tokenJti: input.tokenJti,
    })
    .onConflictDoNothing({
      target: sandboxTunnelTokenRedemptions.tokenJti,
    })
    .returning({
      tokenJti: sandboxTunnelTokenRedemptions.tokenJti,
    });

  return insertedRows[0] !== undefined;
}
