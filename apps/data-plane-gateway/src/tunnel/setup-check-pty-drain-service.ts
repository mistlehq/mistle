import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";

export class SetupCheckPtyDrainService {
  public constructor(
    private readonly dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "setupCheckPtyDrained">,
  ) {}

  public async notifyPtyDrained(input: {
    ownerLeaseId: string;
    sandboxInstanceId: string;
  }): Promise<void> {
    await this.dataPlaneClient.setupCheckPtyDrained({
      sandboxInstanceId: input.sandboxInstanceId,
      ownerLeaseId: input.ownerLeaseId,
    });
  }
}
