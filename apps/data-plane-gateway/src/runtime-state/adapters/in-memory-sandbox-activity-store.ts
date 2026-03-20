import type { Clock } from "@mistle/time";

import type {
  SandboxActivityLeaseKind,
  SandboxActivityLeaseSource,
  SandboxActivityStore,
} from "../sandbox-activity-store.js";

type InMemoryActivityLeaseRecord = {
  sandboxInstanceId: string;
  leaseId: string;
  kind: SandboxActivityLeaseKind;
  source: SandboxActivityLeaseSource;
  externalExecutionId?: string;
  metadata?: Record<string, unknown>;
  nodeId: string;
  expiresAtMs: number;
};

/**
 * Gateway-local activity store used in single-node `memory` mode.
 *
 * Activity leases are stored in memory with TTL-based expiry. Expired leases
 * are pruned on read and on explicit release attempts.
 */
export class InMemorySandboxActivityStore implements SandboxActivityStore {
  readonly #leasesBySandboxInstanceId = new Map<string, Map<string, InMemoryActivityLeaseRecord>>();

  constructor(private readonly clock: Clock) {}

  async touchLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    kind: SandboxActivityLeaseKind;
    source: SandboxActivityLeaseSource;
    externalExecutionId?: string;
    metadata?: Record<string, unknown>;
    nodeId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<void> {
    const currentLeases =
      this.#leasesBySandboxInstanceId.get(input.sandboxInstanceId) ??
      new Map<string, InMemoryActivityLeaseRecord>();

    currentLeases.set(input.leaseId, {
      sandboxInstanceId: input.sandboxInstanceId,
      leaseId: input.leaseId,
      kind: input.kind,
      source: input.source,
      ...(input.externalExecutionId === undefined
        ? {}
        : { externalExecutionId: input.externalExecutionId }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      nodeId: input.nodeId,
      expiresAtMs: input.nowMs + input.ttlMs,
    });

    this.#leasesBySandboxInstanceId.set(input.sandboxInstanceId, currentLeases);
  }

  async renewLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<boolean> {
    this.pruneExpiredLeases(input.sandboxInstanceId);

    const currentLeases = this.#leasesBySandboxInstanceId.get(input.sandboxInstanceId);
    const currentLease = currentLeases?.get(input.leaseId);
    if (currentLeases === undefined || currentLease === undefined) {
      return false;
    }

    currentLeases.set(input.leaseId, {
      ...currentLease,
      expiresAtMs: input.nowMs + input.ttlMs,
    });
    return true;
  }

  async releaseLease(input: { sandboxInstanceId: string; leaseId: string }): Promise<boolean> {
    this.pruneExpiredLeases(input.sandboxInstanceId);

    const currentLeases = this.#leasesBySandboxInstanceId.get(input.sandboxInstanceId);
    if (currentLeases === undefined) {
      return false;
    }

    const didDelete = currentLeases.delete(input.leaseId);
    if (currentLeases.size === 0) {
      this.#leasesBySandboxInstanceId.delete(input.sandboxInstanceId);
    }

    return didDelete;
  }

  async hasAnyActiveLease(input: { sandboxInstanceId: string; nowMs: number }): Promise<boolean> {
    void input.nowMs;

    this.pruneExpiredLeases(input.sandboxInstanceId);
    const currentLeases = this.#leasesBySandboxInstanceId.get(input.sandboxInstanceId);
    return currentLeases !== undefined && currentLeases.size > 0;
  }

  private pruneExpiredLeases(sandboxInstanceId: string): void {
    const currentLeases = this.#leasesBySandboxInstanceId.get(sandboxInstanceId);
    if (currentLeases === undefined) {
      return;
    }

    for (const [leaseId, lease] of currentLeases.entries()) {
      if (lease.expiresAtMs <= this.clock.nowMs()) {
        currentLeases.delete(leaseId);
      }
    }

    if (currentLeases.size === 0) {
      this.#leasesBySandboxInstanceId.delete(sandboxInstanceId);
    }
  }
}
