import { logger } from "../../logger.js";
import type { SandboxKeepaliveSource, SandboxKeepaliveStore } from "../sandbox-keepalive-store.js";
import type { ValkeyClient } from "../valkey-client.js";

type SandboxKeepaliveRecord = {
  sandboxInstanceId: string;
  keepaliveId: string;
  source: SandboxKeepaliveSource;
  externalSubjectId?: string;
  metadata?: Record<string, unknown>;
  nodeId: string;
  expiresAtMs: number;
};

type SandboxKeepaliveStateRecord = {
  sandboxInstanceId: string;
  ownerLeaseId: string;
  nodeId: string;
  active: boolean;
  expiresAtMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildSandboxKeepaliveIndexKey(input: {
  keyPrefix: string;
  sandboxInstanceId: string;
}): string {
  return `${input.keyPrefix}:sandbox-keepalive:${input.sandboxInstanceId}`;
}

function buildSandboxKeepaliveDetailKey(input: {
  keyPrefix: string;
  sandboxInstanceId: string;
  keepaliveId: string;
}): string {
  return `${input.keyPrefix}:sandbox-keepalive:${input.sandboxInstanceId}:record:${input.keepaliveId}`;
}

function buildSandboxKeepaliveStateKey(input: {
  keyPrefix: string;
  sandboxInstanceId: string;
}): string {
  return `${input.keyPrefix}:sandbox-keepalive:${input.sandboxInstanceId}:state`;
}

function parseSandboxKeepaliveRecord(serializedKeepalive: string): SandboxKeepaliveRecord {
  const parsedKeepalive = JSON.parse(serializedKeepalive);
  if (!isRecord(parsedKeepalive)) {
    throw new Error("Expected sandbox keepalive detail record to be an object.");
  }

  const sandboxInstanceId = parsedKeepalive.sandboxInstanceId;
  const keepaliveId = parsedKeepalive.keepaliveId;
  const source = parsedKeepalive.source;
  const nodeId = parsedKeepalive.nodeId;
  const expiresAtMs = parsedKeepalive.expiresAtMs;
  const externalSubjectId = parsedKeepalive.externalSubjectId;
  const metadata = parsedKeepalive.metadata;

  if (
    typeof sandboxInstanceId !== "string" ||
    typeof keepaliveId !== "string" ||
    typeof source !== "string" ||
    typeof nodeId !== "string" ||
    typeof expiresAtMs !== "number"
  ) {
    throw new Error("Unexpected sandbox keepalive detail record.");
  }

  return {
    sandboxInstanceId,
    keepaliveId,
    source,
    ...(typeof externalSubjectId === "string" ? { externalSubjectId } : {}),
    ...(isRecord(metadata) ? { metadata } : {}),
    nodeId,
    expiresAtMs,
  };
}

function parseSandboxKeepaliveStateRecord(
  serializedKeepaliveState: string,
): SandboxKeepaliveStateRecord {
  const parsedKeepaliveState = JSON.parse(serializedKeepaliveState);
  if (!isRecord(parsedKeepaliveState)) {
    throw new Error("Expected sandbox keepalive state record to be an object.");
  }

  const sandboxInstanceId = parsedKeepaliveState.sandboxInstanceId;
  const ownerLeaseId = parsedKeepaliveState.ownerLeaseId;
  const nodeId = parsedKeepaliveState.nodeId;
  const active = parsedKeepaliveState.active;
  const expiresAtMs = parsedKeepaliveState.expiresAtMs;

  if (
    typeof sandboxInstanceId !== "string" ||
    typeof ownerLeaseId !== "string" ||
    typeof nodeId !== "string" ||
    typeof active !== "boolean" ||
    typeof expiresAtMs !== "number"
  ) {
    throw new Error("Unexpected sandbox keepalive state record.");
  }

  return {
    sandboxInstanceId,
    ownerLeaseId,
    nodeId,
    active,
    expiresAtMs,
  };
}

/**
 * Valkey-backed keepalive store for distributed gateway mode.
 *
 * Keepalive state uses one sorted-set index per sandbox plus one detail key per
 * record. The index enables efficient coarse keepalive summaries while the
 * detail key preserves generic source metadata across renewals.
 */
export class ValkeySandboxKeepaliveStore implements SandboxKeepaliveStore {
  constructor(
    private readonly client: ValkeyClient,
    private readonly keyPrefix: string,
  ) {}

  async touchKeepalive(input: {
    sandboxInstanceId: string;
    keepaliveId: string;
    source: SandboxKeepaliveSource;
    externalSubjectId?: string;
    metadata?: Record<string, unknown>;
    nodeId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<void> {
    const expiresAtMs = input.nowMs + input.ttlMs;
    const detailKey = buildSandboxKeepaliveDetailKey({
      keyPrefix: this.keyPrefix,
      sandboxInstanceId: input.sandboxInstanceId,
      keepaliveId: input.keepaliveId,
    });

    await Promise.all([
      this.client.zAdd(
        buildSandboxKeepaliveIndexKey({
          keyPrefix: this.keyPrefix,
          sandboxInstanceId: input.sandboxInstanceId,
        }),
        [
          {
            score: expiresAtMs,
            value: input.keepaliveId,
          },
        ],
      ),
      this.client.set(
        detailKey,
        JSON.stringify({
          sandboxInstanceId: input.sandboxInstanceId,
          keepaliveId: input.keepaliveId,
          source: input.source,
          ...(input.externalSubjectId === undefined
            ? {}
            : { externalSubjectId: input.externalSubjectId }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          nodeId: input.nodeId,
          expiresAtMs,
        } satisfies SandboxKeepaliveRecord),
        {
          PX: input.ttlMs,
        },
      ),
    ]);

    logger.debug(
      {
        event: "sandbox_keepalive_touched",
        sandboxInstanceId: input.sandboxInstanceId,
        keepaliveId: input.keepaliveId,
        source: input.source,
        nodeId: input.nodeId,
        ttlMs: input.ttlMs,
        expiresAtMs,
        ...(input.externalSubjectId === undefined
          ? {}
          : { externalSubjectId: input.externalSubjectId }),
      },
      "Touched sandbox keepalive",
    );
  }

  async replaceStateForOwner(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
    nodeId: string;
    ttlMs: number;
    nowMs: number;
    active: boolean;
  }): Promise<void> {
    const expiresAtMs = input.nowMs + input.ttlMs;
    await this.client.set(
      buildSandboxKeepaliveStateKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      JSON.stringify({
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: input.ownerLeaseId,
        nodeId: input.nodeId,
        active: input.active,
        expiresAtMs,
      } satisfies SandboxKeepaliveStateRecord),
      {
        PX: input.ttlMs,
      },
    );

    logger.debug(
      {
        event: "sandbox_keepalive_state_replaced",
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: input.ownerLeaseId,
        nodeId: input.nodeId,
        ttlMs: input.ttlMs,
        expiresAtMs,
        active: input.active,
      },
      "Replaced sandbox keepalive state",
    );
  }

  async renewKeepalive(input: {
    sandboxInstanceId: string;
    keepaliveId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<boolean> {
    const detailKey = buildSandboxKeepaliveDetailKey({
      keyPrefix: this.keyPrefix,
      sandboxInstanceId: input.sandboxInstanceId,
      keepaliveId: input.keepaliveId,
    });
    const serializedKeepalive = await this.client.get(detailKey);
    if (serializedKeepalive === null) {
      await this.client.zRem(
        buildSandboxKeepaliveIndexKey({
          keyPrefix: this.keyPrefix,
          sandboxInstanceId: input.sandboxInstanceId,
        }),
        input.keepaliveId,
      );
      logger.debug(
        {
          event: "sandbox_keepalive_renew_rejected",
          sandboxInstanceId: input.sandboxInstanceId,
          keepaliveId: input.keepaliveId,
          ttlMs: input.ttlMs,
        },
        "Rejected sandbox keepalive renewal",
      );
      return false;
    }

    const currentKeepalive = parseSandboxKeepaliveRecord(serializedKeepalive);
    const expiresAtMs = input.nowMs + input.ttlMs;

    await Promise.all([
      this.client.zAdd(
        buildSandboxKeepaliveIndexKey({
          keyPrefix: this.keyPrefix,
          sandboxInstanceId: input.sandboxInstanceId,
        }),
        [
          {
            score: expiresAtMs,
            value: input.keepaliveId,
          },
        ],
      ),
      this.client.set(
        detailKey,
        JSON.stringify({
          ...currentKeepalive,
          expiresAtMs,
        } satisfies SandboxKeepaliveRecord),
        {
          PX: input.ttlMs,
        },
      ),
    ]);

    logger.debug(
      {
        event: "sandbox_keepalive_renewed",
        sandboxInstanceId: input.sandboxInstanceId,
        keepaliveId: input.keepaliveId,
        source: currentKeepalive.source,
        nodeId: currentKeepalive.nodeId,
        ttlMs: input.ttlMs,
        expiresAtMs,
        ...(currentKeepalive.externalSubjectId === undefined
          ? {}
          : { externalSubjectId: currentKeepalive.externalSubjectId }),
      },
      "Renewed sandbox keepalive",
    );

    return true;
  }

  async releaseKeepalive(input: {
    sandboxInstanceId: string;
    keepaliveId: string;
  }): Promise<boolean> {
    const removedCount = await this.client.zRem(
      buildSandboxKeepaliveIndexKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      input.keepaliveId,
    );

    await this.client.del(
      buildSandboxKeepaliveDetailKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
        keepaliveId: input.keepaliveId,
      }),
    );

    logger.debug(
      {
        event:
          removedCount === 1 ? "sandbox_keepalive_released" : "sandbox_keepalive_release_rejected",
        sandboxInstanceId: input.sandboxInstanceId,
        keepaliveId: input.keepaliveId,
      },
      removedCount === 1 ? "Released sandbox keepalive" : "Rejected sandbox keepalive release",
    );

    return removedCount === 1;
  }

  async summarize(input: {
    sandboxInstanceId: string;
    nowMs: number;
  }): Promise<{ active: boolean }> {
    const indexKey = buildSandboxKeepaliveIndexKey({
      keyPrefix: this.keyPrefix,
      sandboxInstanceId: input.sandboxInstanceId,
    });

    await this.client.zRemRangeByScore(indexKey, "-inf", input.nowMs);

    const activeKeepaliveCount = await this.client.zCard(indexKey);
    if (activeKeepaliveCount > 0) {
      return {
        active: true,
      };
    }

    const serializedState = await this.client.get(
      buildSandboxKeepaliveStateKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
    );
    if (serializedState === null) {
      return {
        active: false,
      };
    }

    const parsedState = parseSandboxKeepaliveStateRecord(serializedState);
    return {
      active: parsedState.active,
    };
  }
}
