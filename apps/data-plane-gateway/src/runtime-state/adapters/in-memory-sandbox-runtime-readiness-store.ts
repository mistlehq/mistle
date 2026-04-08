import { logger } from "../../logger.js";
import type { SandboxRuntimeReadinessStore } from "../sandbox-runtime-readiness-store.js";

type InMemoryRuntimeReadinessState = {
  sandboxInstanceId: string;
  ownerLeaseId: string;
  nodeId: string;
  ready: boolean;
};

/**
 * Gateway-local runtime-readiness store used in single-node `memory` mode.
 */
export class InMemorySandboxRuntimeReadinessStore implements SandboxRuntimeReadinessStore {
  readonly #stateBySandboxInstanceId = new Map<string, InMemoryRuntimeReadinessState>();

  async replaceStateForOwner(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
    nodeId: string;
    ready: boolean;
  }): Promise<void> {
    this.#stateBySandboxInstanceId.set(input.sandboxInstanceId, {
      sandboxInstanceId: input.sandboxInstanceId,
      ownerLeaseId: input.ownerLeaseId,
      nodeId: input.nodeId,
      ready: input.ready,
    });

    logger.debug(
      {
        event: "sandbox_runtime_readiness_replaced",
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: input.ownerLeaseId,
        nodeId: input.nodeId,
        ready: input.ready,
      },
      "Replaced sandbox runtime readiness state",
    );
  }

  async summarize(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string | null;
  }): Promise<{ ready: boolean }> {
    if (input.ownerLeaseId === null) {
      return { ready: false };
    }

    const currentState = this.#stateBySandboxInstanceId.get(input.sandboxInstanceId);
    if (currentState === undefined || currentState.ownerLeaseId !== input.ownerLeaseId) {
      return { ready: false };
    }

    return { ready: currentState.ready };
  }
}
