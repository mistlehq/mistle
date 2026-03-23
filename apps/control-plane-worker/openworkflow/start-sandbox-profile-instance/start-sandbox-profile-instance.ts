import type {
  DataPlaneSandboxInstancesClient,
  StartSandboxInstanceInput,
} from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type {
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
} from "@mistle/workflow-registry/control-plane";

import { verifySandboxProfileVersionExists } from "./verify-sandbox-profile-version-exists.js";

function cloneStartSandboxRuntimePlan(input: unknown): StartSandboxInstanceInput["runtimePlan"] {
  const clonedRuntimePlan: StartSandboxInstanceInput["runtimePlan"] = JSON.parse(
    JSON.stringify(input),
  );

  return clonedRuntimePlan;
}

export async function startSandboxProfileInstance(
  ctx: {
    db: ControlPlaneDatabase;
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "startSandboxInstance">;
  },
  input: StartSandboxProfileInstanceWorkflowInput,
): Promise<StartSandboxProfileInstanceWorkflowOutput> {
  await verifySandboxProfileVersionExists({
    db: ctx.db,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
  });

  return ctx.dataPlaneClient.startSandboxInstance({
    ...input,
    runtimePlan: cloneStartSandboxRuntimePlan(input.runtimePlan),
  });
}
