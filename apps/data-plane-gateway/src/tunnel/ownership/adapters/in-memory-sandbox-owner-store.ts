import type { Clock } from "@mistle/time";
import { typeid } from "typeid-js";

import { logger } from "../../../logger.js";
import type { SandboxOwnerStore } from "../sandbox-owner-store.js";
import type { SandboxOwner } from "../types.js";

function isOwnerExpired(input: { owner: SandboxOwner; clock: Clock }): boolean {
  return input.owner.expiresAt.getTime() <= input.clock.nowMs();
}

export class InMemorySandboxOwnerStore implements SandboxOwnerStore {
  private readonly ownersBySandboxInstanceId = new Map<string, SandboxOwner>();

  public constructor(private readonly clock: Clock) {}

  public async claimOwner(input: {
    sandboxInstanceId: string;
    nodeId: string;
    sessionId: string;
    ttlMs: number;
  }): Promise<SandboxOwner> {
    const owner: SandboxOwner = {
      sandboxInstanceId: input.sandboxInstanceId,
      nodeId: input.nodeId,
      sessionId: input.sessionId,
      leaseId: typeid("dtl").toString(),
      expiresAt: new Date(this.clock.nowMs() + input.ttlMs),
    };

    this.ownersBySandboxInstanceId.set(input.sandboxInstanceId, owner);
    logger.info(
      {
        event: "sandbox_owner_claimed",
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: owner.leaseId,
        nodeId: input.nodeId,
        sessionId: input.sessionId,
        ttlMs: input.ttlMs,
        expiresAt: owner.expiresAt.toISOString(),
      },
      "Claimed sandbox owner lease",
    );
    return owner;
  }

  public async renewOwnerLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    ttlMs: number;
  }): Promise<boolean> {
    const owner = this.getActiveOwner(input.sandboxInstanceId);
    if (owner === undefined) {
      logger.debug(
        {
          event: "sandbox_owner_renew_rejected",
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
          ttlMs: input.ttlMs,
          reason: "missing_owner",
        },
        "Rejected sandbox owner lease renewal",
      );
      return false;
    }
    if (owner.leaseId !== input.leaseId) {
      logger.debug(
        {
          event: "sandbox_owner_renew_rejected",
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
          currentOwnerLeaseId: owner.leaseId,
          ttlMs: input.ttlMs,
          reason: "stale_lease",
        },
        "Rejected sandbox owner lease renewal",
      );
      return false;
    }

    owner.expiresAt = new Date(this.clock.nowMs() + input.ttlMs);
    logger.debug(
      {
        event: "sandbox_owner_renewed",
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: input.leaseId,
        ttlMs: input.ttlMs,
        expiresAt: owner.expiresAt.toISOString(),
      },
      "Renewed sandbox owner lease",
    );
    return true;
  }

  public async getOwner(input: { sandboxInstanceId: string }): Promise<SandboxOwner | undefined> {
    return this.getActiveOwner(input.sandboxInstanceId);
  }

  public async releaseOwner(input: {
    sandboxInstanceId: string;
    leaseId: string;
  }): Promise<boolean> {
    const owner = this.getActiveOwner(input.sandboxInstanceId);
    if (owner === undefined) {
      logger.debug(
        {
          event: "sandbox_owner_release_rejected",
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
          reason: "missing_owner",
        },
        "Rejected sandbox owner lease release",
      );
      return false;
    }
    if (owner.leaseId !== input.leaseId) {
      logger.debug(
        {
          event: "sandbox_owner_release_rejected",
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
          currentOwnerLeaseId: owner.leaseId,
          reason: "stale_lease",
        },
        "Rejected sandbox owner lease release",
      );
      return false;
    }

    this.ownersBySandboxInstanceId.delete(input.sandboxInstanceId);
    logger.info(
      {
        event: "sandbox_owner_released",
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: input.leaseId,
      },
      "Released sandbox owner lease",
    );
    return true;
  }

  private getActiveOwner(sandboxInstanceId: string): SandboxOwner | undefined {
    const owner = this.ownersBySandboxInstanceId.get(sandboxInstanceId);
    if (owner === undefined) {
      return undefined;
    }
    if (!isOwnerExpired({ owner, clock: this.clock })) {
      return owner;
    }

    this.ownersBySandboxInstanceId.delete(sandboxInstanceId);
    return undefined;
  }
}
