import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { AssociatedResourceEventRouting } from "@mistle/integrations-core";
import type { SandboxInstanceStatus } from "@mistle/sandbox-lifecycle";

import {
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "../../../sandbox-instances/errors.js";

export async function getSandboxInstance(
  {
    dataPlaneClient,
  }: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
  },
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<{
  id: string;
  status: SandboxInstanceStatus;
  failureCode: string | null;
  failureMessage: string | null;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  associatedResourceEventRouting: AssociatedResourceEventRouting | null;
}> {
  const sandboxInstance = await dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance === null) {
    throw new SandboxInstancesNotFoundError(
      SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
      `Sandbox instance '${input.instanceId}' was not found.`,
    );
  }

  return {
    id: sandboxInstance.id,
    status: sandboxInstance.status,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
    sandboxProfileId: sandboxInstance.sandboxProfileId,
    sandboxProfileVersion: sandboxInstance.sandboxProfileVersion,
    associatedResourceEventRouting:
      sandboxInstance.runtimePlan?.associatedResourceEventRouting ?? null,
  };
}
