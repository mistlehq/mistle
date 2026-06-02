import type { DataPlaneDatabase } from "@mistle/db/data-plane";

import type {
  GetSandboxInstanceMetadataInput,
  GetSandboxInstanceMetadataResponse,
} from "../../sandbox/sandbox-instances/get-sandbox-instance-metadata/schema.js";

export async function getSandboxInstanceMetadata(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: GetSandboxInstanceMetadataInput,
): Promise<GetSandboxInstanceMetadataResponse> {
  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      purpose: true,
      deletedAt: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.instanceId), eq(table.organizationId, input.organizationId)),
  });

  return sandboxInstance ?? null;
}
