import type {
  DataPlaneSandboxInstancesClient,
  GetSandboxInstanceResponse,
} from "@mistle/data-plane-internal-client";

type ConnectableSandboxInstance = Pick<
  NonNullable<GetSandboxInstanceResponse>,
  "id" | "runtimePlan"
>;

export async function refreshEgressGrantsForConnectableSandbox(
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "refreshSandboxEgressGrants">,
  input: {
    organizationId: string;
    sandboxInstance: ConnectableSandboxInstance;
    actingUserId?: string;
  },
): Promise<void> {
  if (
    input.sandboxInstance.runtimePlan === null ||
    input.sandboxInstance.runtimePlan.egressRoutes.length === 0
  ) {
    return;
  }

  await dataPlaneClient.refreshSandboxEgressGrants({
    organizationId: input.organizationId,
    instanceId: input.sandboxInstance.id,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
  });
}
