import type { KeepaliveControlMessage } from "@mistle/sandbox-session-protocol";
import type { Clock } from "@mistle/time";

import type { SandboxIdleControllerRegistry } from "../idle/sandbox-idle-controller-registry.js";
import type { SandboxKeepaliveStore } from "../runtime-state/sandbox-keepalive-store.js";

export class SandboxKeepaliveRepository {
  public constructor(
    private readonly keepaliveStore: SandboxKeepaliveStore,
    private readonly sandboxIdleControllerRegistry: SandboxIdleControllerRegistry,
    private readonly clock: Clock,
    private readonly gatewayNodeId: string,
  ) {}

  public async applyControlMessage(input: {
    message: KeepaliveControlMessage;
    sandboxInstanceId: string;
    ownerLeaseId: string;
  }): Promise<void> {
    await this.keepaliveStore.replaceStateForOwner({
      sandboxInstanceId: input.sandboxInstanceId,
      ownerLeaseId: input.ownerLeaseId,
      nodeId: this.gatewayNodeId,
      ttlMs: input.message.ttlMs,
      nowMs: this.clock.nowMs(),
      active: input.message.active,
    });

    this.requireController(input.sandboxInstanceId).handleActivityTouch({
      nowMs: this.clock.nowMs(),
    });
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
