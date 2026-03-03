import { sandboxTunnelConnectAcks, type DataPlaneDatabase } from "@mistle/db/data-plane";

export async function insertSandboxTunnelConnectAck(input: {
  db: DataPlaneDatabase;
  tokenJti: string;
}): Promise<boolean> {
  const insertedRows = await input.db
    .insert(sandboxTunnelConnectAcks)
    .values({
      bootstrapTokenJti: input.tokenJti,
    })
    .onConflictDoNothing({
      target: sandboxTunnelConnectAcks.bootstrapTokenJti,
    })
    .returning({
      bootstrapTokenJti: sandboxTunnelConnectAcks.bootstrapTokenJti,
    });

  return insertedRows[0] !== undefined;
}
