import type { RuntimeReadyControlMessage } from "@mistle/sandbox-session-protocol";

import type { SandboxRuntimeReadinessStore } from "../runtime-state/sandbox-runtime-readiness-store.js";

/**
 * Applies sandbox-emitted runtime-readiness control messages to the gateway store.
 */
export class SandboxRuntimeReadinessRepository {
  public constructor(
    private readonly runtimeReadinessStore: SandboxRuntimeReadinessStore,
    private readonly gatewayNodeId: string,
  ) {}

  public async applyControlMessage(input: {
    message: RuntimeReadyControlMessage;
    sandboxInstanceId: string;
    ownerLeaseId: string;
  }): Promise<void> {
    await this.runtimeReadinessStore.replaceStateForOwner({
      sandboxInstanceId: input.sandboxInstanceId,
      ownerLeaseId: input.ownerLeaseId,
      nodeId: this.gatewayNodeId,
      ready: input.message.ready,
    });
  }
}
