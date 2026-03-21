import { logger } from "../../logger.js";
import type {
  SandboxPresenceLeaseKind,
  SandboxPresenceLeaseSource,
  SandboxPresenceStore,
} from "../sandbox-presence-store.js";
import type { ValkeyClient } from "../valkey-client.js";

type SandboxPresenceLeaseRecord = {
  sandboxInstanceId: string;
  leaseId: string;
  kind: SandboxPresenceLeaseKind;
  source: SandboxPresenceLeaseSource;
  sessionId: string;
  expiresAtMs: number;
};

function buildSandboxPresenceIndexKey(input: {
  keyPrefix: string;
  sandboxInstanceId: string;
}): string {
  return `${input.keyPrefix}:sandbox-presence:${input.sandboxInstanceId}`;
}

function buildSandboxPresenceDetailKey(input: {
  keyPrefix: string;
  sandboxInstanceId: string;
  leaseId: string;
}): string {
  return `${input.keyPrefix}:sandbox-presence:${input.sandboxInstanceId}:lease:${input.leaseId}`;
}

/**
 * Valkey-backed presence store for distributed gateway mode.
 *
 * Presence uses one sorted-set index per sandbox plus one detail key per lease.
 * The index enables efficient "any live presence?" checks while TTL-backed
 * detail keys preserve per-lease metadata for future debugging and inspection.
 */
export class ValkeySandboxPresenceStore implements SandboxPresenceStore {
  constructor(
    private readonly client: ValkeyClient,
    private readonly keyPrefix: string,
  ) {}

  async touchLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    kind: SandboxPresenceLeaseKind;
    source: SandboxPresenceLeaseSource;
    sessionId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<void> {
    const expiresAtMs = input.nowMs + input.ttlMs;

    await Promise.all([
      this.client.zAdd(
        buildSandboxPresenceIndexKey({
          keyPrefix: this.keyPrefix,
          sandboxInstanceId: input.sandboxInstanceId,
        }),
        [
          {
            score: expiresAtMs,
            value: input.leaseId,
          },
        ],
      ),
      this.client.set(
        buildSandboxPresenceDetailKey({
          keyPrefix: this.keyPrefix,
          sandboxInstanceId: input.sandboxInstanceId,
          leaseId: input.leaseId,
        }),
        JSON.stringify({
          sandboxInstanceId: input.sandboxInstanceId,
          leaseId: input.leaseId,
          kind: input.kind,
          source: input.source,
          sessionId: input.sessionId,
          expiresAtMs,
        } satisfies SandboxPresenceLeaseRecord),
        {
          PX: input.ttlMs,
        },
      ),
    ]);

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
    const removedCount = await this.client.zRem(
      buildSandboxPresenceIndexKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      input.leaseId,
    );

    await this.client.del(
      buildSandboxPresenceDetailKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
        leaseId: input.leaseId,
      }),
    );

    logger.debug(
      {
        event:
          removedCount === 1
            ? "sandbox_presence_lease_released"
            : "sandbox_presence_lease_release_rejected",
        sandboxInstanceId: input.sandboxInstanceId,
        presenceLeaseId: input.leaseId,
      },
      removedCount === 1
        ? "Released sandbox presence lease"
        : "Rejected sandbox presence lease release",
    );

    return removedCount === 1;
  }

  async hasAnyActiveLease(input: { sandboxInstanceId: string; nowMs: number }): Promise<boolean> {
    const indexKey = buildSandboxPresenceIndexKey({
      keyPrefix: this.keyPrefix,
      sandboxInstanceId: input.sandboxInstanceId,
    });

    await this.client.zRemRangeByScore(indexKey, "-inf", input.nowMs);

    const activeLeaseCount = await this.client.zCard(indexKey);
    return activeLeaseCount > 0;
  }
}
