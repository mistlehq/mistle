import type { ValkeyClient } from "@mistle/cache";

import { logger } from "../../logger.js";
import type { SandboxRuntimeReadinessStore } from "../sandbox-runtime-readiness-store.js";

type SandboxRuntimeReadinessStateRecord = {
  sandboxInstanceId: string;
  ownerLeaseId: string;
  nodeId: string;
  ready: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildSandboxRuntimeReadinessStateKey(input: {
  keyPrefix: string;
  sandboxInstanceId: string;
}): string {
  return `${input.keyPrefix}:sandbox-runtime-readiness:${input.sandboxInstanceId}:state`;
}

function parseSandboxRuntimeReadinessStateRecord(
  serializedRuntimeReadinessState: string,
): SandboxRuntimeReadinessStateRecord {
  const parsedRuntimeReadinessState = JSON.parse(serializedRuntimeReadinessState);
  if (!isRecord(parsedRuntimeReadinessState)) {
    throw new Error("Expected sandbox runtime readiness state record to be an object.");
  }

  const sandboxInstanceId = parsedRuntimeReadinessState.sandboxInstanceId;
  const ownerLeaseId = parsedRuntimeReadinessState.ownerLeaseId;
  const nodeId = parsedRuntimeReadinessState.nodeId;
  const ready = parsedRuntimeReadinessState.ready;

  if (
    typeof sandboxInstanceId !== "string" ||
    typeof ownerLeaseId !== "string" ||
    typeof nodeId !== "string" ||
    typeof ready !== "boolean"
  ) {
    throw new Error("Unexpected sandbox runtime readiness state record.");
  }

  return {
    sandboxInstanceId,
    ownerLeaseId,
    nodeId,
    ready,
  };
}

/**
 * Valkey-backed runtime-readiness store for distributed gateway mode.
 */
export class ValkeySandboxRuntimeReadinessStore implements SandboxRuntimeReadinessStore {
  constructor(
    private readonly client: ValkeyClient,
    private readonly keyPrefix: string,
  ) {}

  async replaceStateForOwner(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
    nodeId: string;
    ready: boolean;
  }): Promise<void> {
    await this.client.set(
      buildSandboxRuntimeReadinessStateKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      JSON.stringify({
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: input.ownerLeaseId,
        nodeId: input.nodeId,
        ready: input.ready,
      } satisfies SandboxRuntimeReadinessStateRecord),
    );

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

    const serializedState = await this.client.get(
      buildSandboxRuntimeReadinessStateKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
    );
    if (serializedState === null) {
      return { ready: false };
    }

    const currentState = parseSandboxRuntimeReadinessStateRecord(serializedState);
    if (currentState.ownerLeaseId !== input.ownerLeaseId) {
      return { ready: false };
    }

    return { ready: currentState.ready };
  }
}
