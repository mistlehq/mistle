import { createRuntimePlanEgressGrantByRuleId } from "@mistle/sandbox-egress-auth";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";

export async function createEgressGrantByRuleId(input: {
  config: DataPlaneWorkerRuntimeConfig;
  organizationId: string;
  sandboxInstanceId: string;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  actingUserId?: StartSandboxInstanceWorkflowInput["actingUserId"];
}): Promise<Record<string, string>> {
  return await createRuntimePlanEgressGrantByRuleId({
    config: {
      tokenSecret: input.config.sandbox.egress.tokenSecret,
      tokenIssuer: input.config.sandbox.egress.tokenIssuer,
      tokenAudience: input.config.sandbox.egress.tokenAudience,
    },
    organizationId: input.organizationId,
    sandboxInstanceId: input.sandboxInstanceId,
    runtimePlan: input.runtimePlan,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
  });
}
