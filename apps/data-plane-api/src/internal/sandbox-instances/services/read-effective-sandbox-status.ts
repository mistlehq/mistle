import type { SandboxInstance } from "@mistle/db/data-plane";

import type { AppRuntimeResources } from "../../../resources.js";
import { resolveEffectiveSandboxInstanceStatus } from "../effective-sandbox-instance-status.js";
import type { GetSandboxInstanceResponse } from "../schemas.js";

type ReadEffectiveSandboxStatusContext = {
  runtimeStateReader: AppRuntimeResources["runtimeStateReader"];
};

export async function readEffectiveSandboxStatus(
  ctx: ReadEffectiveSandboxStatusContext,
  input: {
    sandboxInstanceId: string;
    persistedStatus: SandboxInstance["status"];
  },
): Promise<NonNullable<GetSandboxInstanceResponse>["status"]> {
  const runtimeStateSnapshot = await ctx.runtimeStateReader.readSnapshot({
    sandboxInstanceId: input.sandboxInstanceId,
    nowMs: Date.now(),
  });

  return resolveEffectiveSandboxInstanceStatus({
    persistedStatus: input.persistedStatus,
    runtimeStateSnapshot,
  });
}
