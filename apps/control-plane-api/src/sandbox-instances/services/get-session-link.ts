import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";

import { buildDashboardUrl } from "../../lib/dashboard-url.js";
import { SandboxInstancesNotFoundCodes, SandboxInstancesNotFoundError } from "../errors.js";

export async function getSessionLink(
  {
    dataPlaneClient,
    dashboardBaseUrl,
  }: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
    dashboardBaseUrl: string;
  },
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<string> {
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

  return buildDashboardUrl(dashboardBaseUrl, `/sessions/${encodeURIComponent(sandboxInstance.id)}`);
}
