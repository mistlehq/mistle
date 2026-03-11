import type { Clock } from "@mistle/time";
import { typeid } from "typeid-js";

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
    return owner;
  }

  public async renewOwnerLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    ttlMs: number;
  }): Promise<boolean> {
    const owner = this.getActiveOwner(input.sandboxInstanceId);
    if (owner === undefined) {
      return false;
    }
    if (owner.leaseId !== input.leaseId) {
      return false;
    }

    owner.expiresAt = new Date(this.clock.nowMs() + input.ttlMs);
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
      return false;
    }
    if (owner.leaseId !== input.leaseId) {
      return false;
    }

    this.ownersBySandboxInstanceId.delete(input.sandboxInstanceId);
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
