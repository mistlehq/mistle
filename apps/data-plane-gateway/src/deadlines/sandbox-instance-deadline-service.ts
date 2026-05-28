import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { Clock } from "@mistle/time";

import { BOOTSTRAP_DISCONNECT_GRACE_MS, IDLE_TIMEOUT_MS } from "../runtime-state/durations.js";

export type DataPlaneGatewayLifecycleDurations = {
  idleTimeoutMs: number;
  bootstrapDisconnectGraceMs: number;
};

export const DefaultDataPlaneGatewayLifecycleDurations: DataPlaneGatewayLifecycleDurations = {
  idleTimeoutMs: IDLE_TIMEOUT_MS,
  bootstrapDisconnectGraceMs: BOOTSTRAP_DISCONNECT_GRACE_MS,
};

export class SandboxInstanceDeadlineService {
  public constructor(
    private readonly dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      | "putSandboxInstanceDeadline"
      | "deleteSandboxInstanceDeadline"
      | "applySandboxRuntimeLifecycleEvent"
    >,
    private readonly clock: Clock,
    private readonly lifecycleDurations: DataPlaneGatewayLifecycleDurations,
  ) {}

  public async handleBootstrapAttach(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
    testEnvironmentId?: string;
  }): Promise<void> {
    await this.dataPlaneClient.applySandboxRuntimeLifecycleEvent({
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "runtime_readiness_reported",
      ownerLeaseId: input.ownerLeaseId,
      runtimeReady: false,
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
    });
    await this.touchIdleDeadline(input);
  }

  public async touchIdleDeadline(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
    testEnvironmentId?: string;
  }): Promise<void> {
    await this.dataPlaneClient.putSandboxInstanceDeadline({
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "idle",
      ownerLeaseId: input.ownerLeaseId,
      dueAt: new Date(this.clock.nowMs() + this.lifecycleDurations.idleTimeoutMs).toISOString(),
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
    });
  }

  public async handleBootstrapDisconnect(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
    testEnvironmentId?: string;
  }): Promise<void> {
    await this.clearIdleDeadline(input);
    await this.dataPlaneClient.applySandboxRuntimeLifecycleEvent({
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "bootstrap_detached",
      ownerLeaseId: input.ownerLeaseId,
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
    });
    await this.dataPlaneClient.putSandboxInstanceDeadline({
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "disconnect",
      ownerLeaseId: input.ownerLeaseId,
      dueAt: new Date(
        this.clock.nowMs() + this.lifecycleDurations.bootstrapDisconnectGraceMs,
      ).toISOString(),
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
    });
  }

  public async handleRuntimeReadiness(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
    ready: boolean;
    testEnvironmentId?: string;
  }): Promise<void> {
    await this.dataPlaneClient.applySandboxRuntimeLifecycleEvent({
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "runtime_readiness_reported",
      ownerLeaseId: input.ownerLeaseId,
      runtimeReady: input.ready,
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
    });
  }

  public async clearIdleDeadline(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
    testEnvironmentId?: string;
  }): Promise<void> {
    await this.dataPlaneClient.deleteSandboxInstanceDeadline({
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "idle",
      ownerLeaseId: input.ownerLeaseId,
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
    });
  }
}
