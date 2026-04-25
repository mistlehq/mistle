import { logger } from "../../logger.js";
import type {
  SandboxPresenceLeaseSource,
  SandboxPresenceStore,
} from "../sandbox-presence-store.js";
import type { ValkeyClient } from "../valkey-client.js";

type SandboxPresenceLeaseRecord = {
  sandboxInstanceId: string;
  leaseId: string;
  source: SandboxPresenceLeaseSource;
  sessionId: string;
  expiresAtMs: number;
};

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

function parseIntegerReply(input: unknown): number {
  if (typeof input === "number" && Number.isInteger(input)) {
    return input;
  }

  const parsed = Number(input);
  if (Number.isInteger(parsed)) {
    return parsed;
  }

  throw new Error(`Unexpected Valkey integer reply: ${String(input)}`);
}

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
    source: SandboxPresenceLeaseSource;
    sessionId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<void> {
    const expiresAtMs = input.nowMs + input.ttlMs;
    const indexKey = buildSandboxPresenceIndexKey({
      keyPrefix: this.keyPrefix,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    const detailKey = buildSandboxPresenceDetailKey({
      keyPrefix: this.keyPrefix,
      sandboxInstanceId: input.sandboxInstanceId,
      leaseId: input.leaseId,
    });

    await this.client
      .multi()
      .zAdd(indexKey, [
        {
          score: expiresAtMs,
          value: input.leaseId,
        },
      ])
      .set(
        detailKey,
        JSON.stringify({
          sandboxInstanceId: input.sandboxInstanceId,
          leaseId: input.leaseId,
          source: input.source,
          sessionId: input.sessionId,
          expiresAtMs,
        } satisfies SandboxPresenceLeaseRecord),
        {
          PX: input.ttlMs,
        },
      )
      .exec();

    logger.debug(
      {
        event: "sandbox_presence_lease_touched",
        sandboxInstanceId: input.sandboxInstanceId,
        presenceLeaseId: input.leaseId,
        source: input.source,
        sessionId: input.sessionId,
        ttlMs: input.ttlMs,
        expiresAtMs,
      },
      "Touched sandbox presence lease",
    );
  }

  async releaseLease(input: { sandboxInstanceId: string; leaseId: string }): Promise<boolean> {
    const indexKey = buildSandboxPresenceIndexKey({
      keyPrefix: this.keyPrefix,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    const detailKey = buildSandboxPresenceDetailKey({
      keyPrefix: this.keyPrefix,
      sandboxInstanceId: input.sandboxInstanceId,
      leaseId: input.leaseId,
    });
    const results = await this.client.multi().zRem(indexKey, input.leaseId).del(detailKey).exec();
    const removedCount = parseIntegerReply(results[0]);

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
    return (await this.countActiveLeases(input)) > 0;
  }

  async countActiveLeases(input: { sandboxInstanceId: string; nowMs: number }): Promise<number> {
    const indexKey = buildSandboxPresenceIndexKey({
      keyPrefix: this.keyPrefix,
      sandboxInstanceId: input.sandboxInstanceId,
    });

    await this.client.zRemRangeByScore(indexKey, "-inf", input.nowMs);

    const activeLeaseIds = await this.client.zRange(indexKey, 0, -1);
    if (activeLeaseIds.length === 0) {
      return 0;
    }

    const missingLeaseIds = (
      await Promise.all(
        activeLeaseIds.map(async (leaseId) => {
          const detailExists = await this.client.exists(
            buildSandboxPresenceDetailKey({
              keyPrefix: this.keyPrefix,
              sandboxInstanceId: input.sandboxInstanceId,
              leaseId,
            }),
          );

          return detailExists === 0 ? leaseId : null;
        }),
      )
    ).filter(isDefined);

    if (missingLeaseIds.length > 0) {
      await this.client.zRem(indexKey, missingLeaseIds);
    }

    return activeLeaseIds.length - missingLeaseIds.length;
  }
}
