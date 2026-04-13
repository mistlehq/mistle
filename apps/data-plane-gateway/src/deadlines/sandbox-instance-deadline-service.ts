import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { Clock } from "@mistle/time";

export class SandboxInstanceDeadlineService {
  public constructor(
    private readonly dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "putSandboxInstanceDeadline" | "deleteSandboxInstanceDeadline"
    >,
    private readonly clock: Clock,
    private readonly lifecycleConfig: {
      idleTimeoutMs: number;
      bootstrapDisconnectGraceMs: number;
    },
  ) {}

  public async handleBootstrapAttach(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
  }): Promise<void> {
    await this.clearDisconnectDeadline({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    await this.touchIdleDeadline(input);
  }

  public async touchIdleDeadline(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
  }): Promise<void> {
    await this.dataPlaneClient.putSandboxInstanceDeadline({
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "idle",
      ownerLeaseId: input.ownerLeaseId,
      dueAt: new Date(this.clock.nowMs() + this.lifecycleConfig.idleTimeoutMs).toISOString(),
    });
  }

  public async handleBootstrapDisconnect(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
  }): Promise<void> {
    await this.clearIdleDeadline({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    await this.dataPlaneClient.putSandboxInstanceDeadline({
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "disconnect",
      ownerLeaseId: input.ownerLeaseId,
      dueAt: new Date(
        this.clock.nowMs() + this.lifecycleConfig.bootstrapDisconnectGraceMs,
      ).toISOString(),
    });
  }

  public async clearIdleDeadline(input: { sandboxInstanceId: string }): Promise<void> {
    await this.dataPlaneClient.deleteSandboxInstanceDeadline({
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "idle",
    });
  }

  public async clearDisconnectDeadline(input: { sandboxInstanceId: string }): Promise<void> {
    await this.dataPlaneClient.deleteSandboxInstanceDeadline({
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "disconnect",
    });
  }
}
