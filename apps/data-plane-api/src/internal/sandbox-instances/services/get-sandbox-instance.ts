import type { DataPlaneDatabase } from "@mistle/db/data-plane";

import type { AppRuntimeResources } from "../../../resources.js";
import type {
  GetSandboxInstanceInput,
  GetSandboxInstanceResponse,
} from "../get-sandbox-instance/schema.js";
import { readEffectiveSandboxStatus } from "./read-effective-sandbox-status.js";

type GetSandboxInstanceContext = {
  db: DataPlaneDatabase;
  runtimeStateReader: AppRuntimeResources["runtimeStateReader"];
};

export async function getSandboxInstance(
  ctx: GetSandboxInstanceContext,
  input: GetSandboxInstanceInput,
): Promise<GetSandboxInstanceResponse> {
  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      status: true,
      failureCode: true,
      failureMessage: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.instanceId), eq(table.organizationId, input.organizationId)),
  });

  if (sandboxInstance === undefined) {
    return null;
  }

  return {
    id: sandboxInstance.id,
    status: await readEffectiveSandboxStatus(
      {
        runtimeStateReader: ctx.runtimeStateReader,
      },
      {
        sandboxInstanceId: sandboxInstance.id,
        persistedStatus: sandboxInstance.status,
      },
    ),
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
  };
}
