import { sandboxTunnelTokenRedemptions, type DataPlaneDatabase } from "@mistle/db/data-plane";

export async function recordSandboxTunnelTokenRedemption(input: {
  db: DataPlaneDatabase;
  tokenJti: string;
}): Promise<boolean> {
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
