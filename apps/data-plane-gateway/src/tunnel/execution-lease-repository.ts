import type { LeaseControlMessage } from "@mistle/sandbox-session-protocol";
import type { Clock } from "@mistle/time";

import type { SandboxIdleControllerRegistry } from "../idle/sandbox-idle-controller-registry.js";
import type { SandboxActivityStore } from "../runtime-state/sandbox-activity-store.js";
import {
  createSandboxExecutionLease,
  renewSandboxExecutionLease,
} from "./execution-lease-store.js";

export class ExecutionLeaseRepository {
  public constructor(
    private readonly activityStore: SandboxActivityStore,
    private readonly sandboxIdleControllerRegistry: SandboxIdleControllerRegistry,
    private readonly clock: Clock,
    private readonly gatewayNodeId: string,
  ) {}

  public async applyControlMessage(input: {
    message: LeaseControlMessage;
    sandboxInstanceId: string;
  }): Promise<void> {
    switch (input.message.type) {
      case "lease.create":
        await createSandboxExecutionLease({
          activityStore: this.activityStore,
          clock: this.clock,
          gatewayNodeId: this.gatewayNodeId,
          lease: input.message.lease,
          sandboxInstanceId: input.sandboxInstanceId,
        });
        this.requireController(input.sandboxInstanceId).handleActivityLeaseTouch({
          leaseId: input.message.lease.id,
          nowMs: this.clock.nowMs(),
        });
        return;
      case "lease.renew":
        await renewSandboxExecutionLease({
          activityStore: this.activityStore,
          clock: this.clock,
          leaseId: input.message.leaseId,
          sandboxInstanceId: input.sandboxInstanceId,
        });
        this.requireController(input.sandboxInstanceId).handleActivityLeaseTouch({
          leaseId: input.message.leaseId,
          nowMs: this.clock.nowMs(),
        });
    }
  }

  private requireController(sandboxInstanceId: string) {
    const sandboxIdleController = this.sandboxIdleControllerRegistry.getController({
      sandboxInstanceId,
    });
    if (sandboxIdleController !== null) {
      return sandboxIdleController;
    }

    throw new Error(`Expected idle controller for sandbox '${sandboxInstanceId}'.`);
  }
}
