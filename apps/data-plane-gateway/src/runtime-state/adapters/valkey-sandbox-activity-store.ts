import type {
  SandboxActivityLeaseKind,
  SandboxActivityLeaseSource,
  SandboxActivityStore,
} from "../sandbox-activity-store.js";
import type { ValkeyClient } from "../valkey-client.js";

type SandboxActivityLeaseRecord = {
  sandboxInstanceId: string;
  leaseId: string;
  kind: SandboxActivityLeaseKind;
  source: SandboxActivityLeaseSource;
  externalExecutionId?: string;
  metadata?: Record<string, unknown>;
  nodeId: string;
  expiresAtMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildSandboxActivityIndexKey(input: {
  keyPrefix: string;
  sandboxInstanceId: string;
}): string {
  return `${input.keyPrefix}:sandbox-activity:${input.sandboxInstanceId}`;
}

function buildSandboxActivityDetailKey(input: {
  keyPrefix: string;
  sandboxInstanceId: string;
  leaseId: string;
}): string {
  return `${input.keyPrefix}:sandbox-activity:${input.sandboxInstanceId}:lease:${input.leaseId}`;
}

function parseSandboxActivityLeaseRecord(serializedLease: string): SandboxActivityLeaseRecord {
  const parsedLease = JSON.parse(serializedLease);
  if (!isRecord(parsedLease)) {
    throw new Error("Expected sandbox activity lease detail record to be an object.");
  }

  const sandboxInstanceId = parsedLease.sandboxInstanceId;
  const leaseId = parsedLease.leaseId;
  const kind = parsedLease.kind;
  const source = parsedLease.source;
  const nodeId = parsedLease.nodeId;
  const expiresAtMs = parsedLease.expiresAtMs;
  const externalExecutionId = parsedLease.externalExecutionId;
  const metadata = parsedLease.metadata;

  if (
    typeof sandboxInstanceId !== "string" ||
    typeof leaseId !== "string" ||
    kind !== "agent_execution" ||
    typeof source !== "string" ||
    typeof nodeId !== "string" ||
    typeof expiresAtMs !== "number"
  ) {
    throw new Error("Unexpected sandbox activity lease detail record.");
  }

  return {
    sandboxInstanceId,
    leaseId,
    kind,
    source,
    ...(typeof externalExecutionId === "string" ? { externalExecutionId } : {}),
    ...(isRecord(metadata) ? { metadata } : {}),
    nodeId,
    expiresAtMs,
  };
}

/**
 * Valkey-backed activity store for distributed gateway mode.
 *
 * Activity uses one sorted-set index per sandbox plus one detail key per
 * lease. The index enables efficient "any live activity?" checks while the
 * detail key preserves execution metadata across renewals.
 */
export class ValkeySandboxActivityStore implements SandboxActivityStore {
  constructor(
    private readonly client: ValkeyClient,
    private readonly keyPrefix: string,
  ) {}

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
    const expiresAtMs = input.nowMs + input.ttlMs;

    await Promise.all([
      this.client.zAdd(
        buildSandboxActivityIndexKey({
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
        buildSandboxActivityDetailKey({
          keyPrefix: this.keyPrefix,
          sandboxInstanceId: input.sandboxInstanceId,
          leaseId: input.leaseId,
        }),
        JSON.stringify({
          sandboxInstanceId: input.sandboxInstanceId,
          leaseId: input.leaseId,
          kind: input.kind,
          source: input.source,
          ...(input.externalExecutionId === undefined
            ? {}
            : { externalExecutionId: input.externalExecutionId }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          nodeId: input.nodeId,
          expiresAtMs,
        } satisfies SandboxActivityLeaseRecord),
        {
          PX: input.ttlMs,
        },
      ),
    ]);
  }

  async renewLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<boolean> {
    const detailKey = buildSandboxActivityDetailKey({
      keyPrefix: this.keyPrefix,
      sandboxInstanceId: input.sandboxInstanceId,
      leaseId: input.leaseId,
    });
    const serializedLease = await this.client.get(detailKey);
    if (serializedLease === null) {
      await this.client.zRem(
        buildSandboxActivityIndexKey({
          keyPrefix: this.keyPrefix,
          sandboxInstanceId: input.sandboxInstanceId,
        }),
        input.leaseId,
      );
      return false;
    }

    const currentLease = parseSandboxActivityLeaseRecord(serializedLease);
    const expiresAtMs = input.nowMs + input.ttlMs;

    await Promise.all([
      this.client.zAdd(
        buildSandboxActivityIndexKey({
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
        detailKey,
        JSON.stringify({
          ...currentLease,
          expiresAtMs,
        } satisfies SandboxActivityLeaseRecord),
        {
          PX: input.ttlMs,
        },
      ),
    ]);

    return true;
  }

  async releaseLease(input: { sandboxInstanceId: string; leaseId: string }): Promise<boolean> {
    const removedCount = await this.client.zRem(
      buildSandboxActivityIndexKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      input.leaseId,
    );

    await this.client.del(
      buildSandboxActivityDetailKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
        leaseId: input.leaseId,
      }),
    );

    return removedCount === 1;
  }

  async hasAnyActiveLease(input: { sandboxInstanceId: string; nowMs: number }): Promise<boolean> {
    const indexKey = buildSandboxActivityIndexKey({
      keyPrefix: this.keyPrefix,
      sandboxInstanceId: input.sandboxInstanceId,
    });

    await this.client.zRemRangeByScore(indexKey, "-inf", input.nowMs);

    const activeLeaseCount = await this.client.zCard(indexKey);
    return activeLeaseCount > 0;
  }
}
