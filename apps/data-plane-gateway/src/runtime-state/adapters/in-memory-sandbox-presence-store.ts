import type { Clock } from "@mistle/time";

import type {
  SandboxPresenceLeaseKind,
  SandboxPresenceLeaseSource,
  SandboxPresenceStore,
} from "../sandbox-presence-store.js";

type InMemoryPresenceLeaseRecord = {
  sandboxInstanceId: string;
  leaseId: string;
  kind: SandboxPresenceLeaseKind;
  source: SandboxPresenceLeaseSource;
  sessionId: string;
  expiresAtMs: number;
};

/**
 * Gateway-local presence store used in single-node `memory` mode.
 *
 * Presence leases are stored in memory with TTL-based expiry. Expired leases
 * are pruned on read and on explicit release attempts.
 */
export class InMemorySandboxPresenceStore implements SandboxPresenceStore {
  readonly #leasesBySandboxInstanceId = new Map<string, Map<string, InMemoryPresenceLeaseRecord>>();

  constructor(private readonly clock: Clock) {}

  async touchLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    kind: SandboxPresenceLeaseKind;
    source: SandboxPresenceLeaseSource;
    sessionId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<void> {
    const currentLeases =
      this.#leasesBySandboxInstanceId.get(input.sandboxInstanceId) ??
      new Map<string, InMemoryPresenceLeaseRecord>();

    currentLeases.set(input.leaseId, {
      sandboxInstanceId: input.sandboxInstanceId,
      leaseId: input.leaseId,
      kind: input.kind,
      source: input.source,
      sessionId: input.sessionId,
      expiresAtMs: input.nowMs + input.ttlMs,
    });

    this.#leasesBySandboxInstanceId.set(input.sandboxInstanceId, currentLeases);
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
