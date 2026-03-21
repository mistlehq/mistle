import { typeid } from "typeid-js";
import { z } from "zod";

import { logger } from "../../../logger.js";
import type { ValkeyClient } from "../../../runtime-state/valkey-client.js";
import type { SandboxOwnerStore } from "../sandbox-owner-store.js";
import type { SandboxOwner } from "../types.js";

const SandboxOwnerRecordSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    nodeId: z.string().min(1),
    sessionId: z.string().min(1),
    leaseId: z.string().min(1),
    expiresAtMs: z.number().int().nonnegative(),
  })
  .strict();

const RenewOwnerLeaseScript = `
local current = redis.call('GET', KEYS[1])
if not current then
  return 0
end

local currentRecord = cjson.decode(current)
if currentRecord["leaseId"] ~= ARGV[1] then
  return 0
end

redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[2])
return 1
`;

const ReleaseOwnerLeaseScript = `
local current = redis.call('GET', KEYS[1])
if not current then
  return 0
end

local currentRecord = cjson.decode(current)
if currentRecord["leaseId"] ~= ARGV[1] then
  return 0
end

redis.call('DEL', KEYS[1])
return 1
`;

type SandboxOwnerRecord = z.infer<typeof SandboxOwnerRecordSchema>;

function buildSandboxOwnerKey(input: { keyPrefix: string; sandboxInstanceId: string }): string {
  return `${input.keyPrefix}:sandbox-owner:${input.sandboxInstanceId}`;
}

function parseSandboxOwnerRecord(json: string): SandboxOwnerRecord {
  return SandboxOwnerRecordSchema.parse(JSON.parse(json));
}

function toSandboxOwner(record: SandboxOwnerRecord): SandboxOwner {
  return {
    sandboxInstanceId: record.sandboxInstanceId,
    nodeId: record.nodeId,
    sessionId: record.sessionId,
    leaseId: record.leaseId,
    expiresAt: new Date(record.expiresAtMs),
  };
}

function parseEvalBooleanResult(result: unknown): boolean {
  if (result === 0) {
    return false;
  }

  if (result === 1) {
    return true;
  }

  throw new Error(`Unexpected Valkey script result: ${String(result)}`);
}

/**
 * Valkey-backed exclusive owner lease store for distributed gateway mode.
 *
 * Claim overwrites the current owner record, while renew and release are
 * atomically fenced by `leaseId` so stale owners cannot mutate newer leases.
 */
export class ValkeySandboxOwnerStore implements SandboxOwnerStore {
  constructor(
    private readonly client: ValkeyClient,
    private readonly keyPrefix: string,
  ) {}

  async claimOwner(input: {
    sandboxInstanceId: string;
    nodeId: string;
    sessionId: string;
    ttlMs: number;
  }): Promise<SandboxOwner> {
    const ownerRecord: SandboxOwnerRecord = {
      sandboxInstanceId: input.sandboxInstanceId,
      nodeId: input.nodeId,
      sessionId: input.sessionId,
      leaseId: typeid("dtl").toString(),
      expiresAtMs: Date.now() + input.ttlMs,
    };

    await this.client.set(
      buildSandboxOwnerKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      JSON.stringify(ownerRecord),
      {
        PX: input.ttlMs,
      },
    );

    logger.info(
      {
        event: "sandbox_owner_claimed",
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: ownerRecord.leaseId,
        nodeId: input.nodeId,
        sessionId: input.sessionId,
        ttlMs: input.ttlMs,
        expiresAtMs: ownerRecord.expiresAtMs,
      },
      "Claimed sandbox owner lease",
    );

    return toSandboxOwner(ownerRecord);
  }

  async renewOwnerLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    ttlMs: number;
  }): Promise<boolean> {
    const currentOwner = await this.getOwner({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (currentOwner === undefined) {
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
    if (currentOwner.leaseId !== input.leaseId) {
      logger.debug(
        {
          event: "sandbox_owner_renew_rejected",
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
          currentOwnerLeaseId: currentOwner.leaseId,
          ttlMs: input.ttlMs,
          reason: "stale_lease",
        },
        "Rejected sandbox owner lease renewal",
      );
      return false;
    }

    const nextOwnerRecord: SandboxOwnerRecord = {
      sandboxInstanceId: currentOwner.sandboxInstanceId,
      nodeId: currentOwner.nodeId,
      sessionId: currentOwner.sessionId,
      leaseId: currentOwner.leaseId,
      expiresAtMs: Date.now() + input.ttlMs,
    };

    const result = await this.client.sendCommand([
      "EVAL",
      RenewOwnerLeaseScript,
      "1",
      buildSandboxOwnerKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      input.leaseId,
      String(input.ttlMs),
      JSON.stringify(nextOwnerRecord),
    ]);

    const didRenew = parseEvalBooleanResult(result);
    if (didRenew) {
      logger.debug(
        {
          event: "sandbox_owner_renewed",
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
          ttlMs: input.ttlMs,
          expiresAtMs: nextOwnerRecord.expiresAtMs,
        },
        "Renewed sandbox owner lease",
      );
    } else {
      logger.debug(
        {
          event: "sandbox_owner_renew_rejected",
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
          ttlMs: input.ttlMs,
          reason: "script_rejected",
        },
        "Rejected sandbox owner lease renewal",
      );
    }

    return didRenew;
  }

  async getOwner(input: { sandboxInstanceId: string }): Promise<SandboxOwner | undefined> {
    const currentOwnerJson = await this.client.get(
      buildSandboxOwnerKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
    );
    if (currentOwnerJson === null) {
      return undefined;
    }

    return toSandboxOwner(parseSandboxOwnerRecord(currentOwnerJson));
  }

  async releaseOwner(input: { sandboxInstanceId: string; leaseId: string }): Promise<boolean> {
    const result = await this.client.sendCommand([
      "EVAL",
      ReleaseOwnerLeaseScript,
      "1",
      buildSandboxOwnerKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      input.leaseId,
    ]);

    const didRelease = parseEvalBooleanResult(result);
    if (didRelease) {
      logger.info(
        {
          event: "sandbox_owner_released",
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
        },
        "Released sandbox owner lease",
      );
    } else {
      logger.debug(
        {
          event: "sandbox_owner_release_rejected",
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
          reason: "script_rejected",
        },
        "Rejected sandbox owner lease release",
      );
    }

    return didRelease;
  }
}
