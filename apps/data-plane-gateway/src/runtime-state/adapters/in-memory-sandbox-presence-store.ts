import type { Clock } from "@mistle/time";

import { logger } from "../../logger.js";
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
    const expiresAtMs = input.nowMs + input.ttlMs;

    currentLeases.set(input.leaseId, {
      sandboxInstanceId: input.sandboxInstanceId,
      leaseId: input.leaseId,
      kind: input.kind,
      source: input.source,
      sessionId: input.sessionId,
      expiresAtMs,
    });

    this.#leasesBySandboxInstanceId.set(input.sandboxInstanceId, currentLeases);
    logger.debug(
      {
        event: "sandbox_presence_lease_touched",
        sandboxInstanceId: input.sandboxInstanceId,
        presenceLeaseId: input.leaseId,
        kind: input.kind,
        source: input.source,
        sessionId: input.sessionId,
        ttlMs: input.ttlMs,
        expiresAtMs,
      },
      "Touched sandbox presence lease",
    );
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

    logger.debug(
      {
        event: didDelete
          ? "sandbox_presence_lease_released"
          : "sandbox_presence_lease_release_rejected",
        sandboxInstanceId: input.sandboxInstanceId,
        presenceLeaseId: input.leaseId,
      },
      didDelete ? "Released sandbox presence lease" : "Rejected sandbox presence lease release",
    );

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
