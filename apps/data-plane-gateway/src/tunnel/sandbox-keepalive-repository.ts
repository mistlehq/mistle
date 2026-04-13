import type { KeepaliveControlMessage } from "@mistle/sandbox-session-protocol";
import type { Clock } from "@mistle/time";

import type { SandboxInstanceDeadlineService } from "../deadlines/sandbox-instance-deadline-service.js";
import type { SandboxKeepaliveStore } from "../runtime-state/sandbox-keepalive-store.js";
import type { SandboxOwnerStore } from "./ownership/sandbox-owner-store.js";

export class SandboxKeepaliveRepository {
  public constructor(
    private readonly keepaliveStore: SandboxKeepaliveStore,
    private readonly sandboxInstanceDeadlineService: SandboxInstanceDeadlineService,
    private readonly sandboxOwnerStore: SandboxOwnerStore,
    private readonly clock: Clock,
    private readonly gatewayNodeId: string,
  ) {}

  public async applyControlMessage(input: {
    message: KeepaliveControlMessage;
    sandboxInstanceId: string;
    ownerLeaseId: string;
  }): Promise<void> {
    const nowMs = this.clock.nowMs();

    await this.keepaliveStore.replaceStateForOwner({
      sandboxInstanceId: input.sandboxInstanceId,
      ownerLeaseId: input.ownerLeaseId,
      nodeId: this.gatewayNodeId,
      ttlMs: input.message.ttlMs,
      nowMs,
      active: input.message.active,
    });

    if (!input.message.active) {
      return;
    }

    const owner = await this.sandboxOwnerStore.getOwner({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (owner === undefined) {
      throw new Error(
        `Expected active owner lease for sandbox '${input.sandboxInstanceId}' before applying keepalive activity.`,
      );
    }

    await this.sandboxInstanceDeadlineService.touchIdleDeadline({
      sandboxInstanceId: input.sandboxInstanceId,
      ownerLeaseId: owner.leaseId,
    });
  }
}
