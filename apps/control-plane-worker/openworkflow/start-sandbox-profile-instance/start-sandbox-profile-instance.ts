import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type {
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
} from "@mistle/workflow-registry/control-plane";

import { verifySandboxProfileVersionExists } from "./verify-sandbox-profile-version-exists.js";

export async function startSandboxProfileInstance(
  deps: {
    db: ControlPlaneDatabase;
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "startSandboxInstance">;
  },
  input: StartSandboxProfileInstanceWorkflowInput,
): Promise<StartSandboxProfileInstanceWorkflowOutput> {
  await verifySandboxProfileVersionExists({
    db: deps.db,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
  });

  return deps.dataPlaneClient.startSandboxInstance(input);
}
