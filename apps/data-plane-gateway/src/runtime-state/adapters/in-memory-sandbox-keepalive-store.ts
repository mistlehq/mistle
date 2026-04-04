import type { Clock } from "@mistle/time";

import { logger } from "../../logger.js";
import type { SandboxKeepaliveSource, SandboxKeepaliveStore } from "../sandbox-keepalive-store.js";

type InMemoryKeepaliveRecord = {
  sandboxInstanceId: string;
  keepaliveId: string;
  source: SandboxKeepaliveSource;
  externalSubjectId?: string;
  metadata?: Record<string, unknown>;
  nodeId: string;
  expiresAtMs: number;
};

/**
 * Gateway-local keepalive store used in single-node `memory` mode.
 *
 * Keepalive records are stored in memory with TTL-based expiry. Expired
 * records are pruned on read and on explicit release attempts.
 */
export class InMemorySandboxKeepaliveStore implements SandboxKeepaliveStore {
  readonly #keepalivesBySandboxInstanceId = new Map<string, Map<string, InMemoryKeepaliveRecord>>();

  constructor(private readonly clock: Clock) {}

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
    const currentKeepalives =
      this.#keepalivesBySandboxInstanceId.get(input.sandboxInstanceId) ??
      new Map<string, InMemoryKeepaliveRecord>();
    const expiresAtMs = input.nowMs + input.ttlMs;

    currentKeepalives.set(input.keepaliveId, {
      sandboxInstanceId: input.sandboxInstanceId,
      keepaliveId: input.keepaliveId,
      source: input.source,
      ...(input.externalSubjectId === undefined
        ? {}
        : { externalSubjectId: input.externalSubjectId }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      nodeId: input.nodeId,
      expiresAtMs,
    });

    this.#keepalivesBySandboxInstanceId.set(input.sandboxInstanceId, currentKeepalives);
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

  async renewKeepalive(input: {
    sandboxInstanceId: string;
    keepaliveId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<boolean> {
    this.pruneExpiredKeepalives(input.sandboxInstanceId);

    const currentKeepalives = this.#keepalivesBySandboxInstanceId.get(input.sandboxInstanceId);
    const currentKeepalive = currentKeepalives?.get(input.keepaliveId);
    if (currentKeepalives === undefined || currentKeepalive === undefined) {
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

    currentKeepalives.set(input.keepaliveId, {
      ...currentKeepalive,
      expiresAtMs: input.nowMs + input.ttlMs,
    });
    logger.debug(
      {
        event: "sandbox_keepalive_renewed",
        sandboxInstanceId: input.sandboxInstanceId,
        keepaliveId: input.keepaliveId,
        source: currentKeepalive.source,
        nodeId: currentKeepalive.nodeId,
        ttlMs: input.ttlMs,
        expiresAtMs: input.nowMs + input.ttlMs,
      },
      "Renewed sandbox keepalive",
    );
    return true;
  }

  async releaseKeepalive(input: {
    sandboxInstanceId: string;
    keepaliveId: string;
  }): Promise<boolean> {
    this.pruneExpiredKeepalives(input.sandboxInstanceId);

    const currentKeepalives = this.#keepalivesBySandboxInstanceId.get(input.sandboxInstanceId);
    if (currentKeepalives === undefined) {
      return false;
    }

    const didDelete = currentKeepalives.delete(input.keepaliveId);
    if (currentKeepalives.size === 0) {
      this.#keepalivesBySandboxInstanceId.delete(input.sandboxInstanceId);
    }

    logger.debug(
      {
        event: didDelete ? "sandbox_keepalive_released" : "sandbox_keepalive_release_rejected",
        sandboxInstanceId: input.sandboxInstanceId,
        keepaliveId: input.keepaliveId,
      },
      didDelete ? "Released sandbox keepalive" : "Rejected sandbox keepalive release",
    );

    return didDelete;
  }

  async summarize(input: {
    sandboxInstanceId: string;
    nowMs: number;
  }): Promise<{ active: boolean }> {
    this.pruneExpiredKeepalives(input.sandboxInstanceId, input.nowMs);
    const currentKeepalives = this.#keepalivesBySandboxInstanceId.get(input.sandboxInstanceId);
    return {
      active: currentKeepalives !== undefined && currentKeepalives.size > 0,
    };
  }

  private pruneExpiredKeepalives(
    sandboxInstanceId: string,
    nowMs: number = this.clock.nowMs(),
  ): void {
    const currentKeepalives = this.#keepalivesBySandboxInstanceId.get(sandboxInstanceId);
    if (currentKeepalives === undefined) {
      return;
    }

    for (const [keepaliveId, keepalive] of currentKeepalives.entries()) {
      if (keepalive.expiresAtMs <= nowMs) {
        currentKeepalives.delete(keepaliveId);
      }
    }

    if (currentKeepalives.size === 0) {
      this.#keepalivesBySandboxInstanceId.delete(sandboxInstanceId);
    }
  }
}
