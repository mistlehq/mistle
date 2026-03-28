import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { getInstance } from "./get-instance.js";
import type { SandboxInstanceStatus } from "./types.js";

export async function resumeInstance(
  {
    db,
    dataPlaneClient,
  }: {
    db: ControlPlaneDatabase;
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "getSandboxInstance" | "resumeSandboxInstance"
    >;
  },
  input: {
    organizationId: string;
    instanceId: string;
    idempotencyKey?: string;
  },
): Promise<SandboxInstanceStatus> {
  const sandboxInstance = await getInstance(
    {
      db,
      dataPlaneClient,
    },
    {
      organizationId: input.organizationId,
      instanceId: input.instanceId,
    },
  );

  if (
    sandboxInstance.status === "running" ||
    sandboxInstance.status === "pending" ||
    sandboxInstance.status === "starting"
  ) {
    return sandboxInstance;
  }

  await dataPlaneClient.resumeSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  });

  return {
    ...sandboxInstance,
    status: "starting",
    failureCode: null,
    failureMessage: null,
  };
}
