import { z } from "zod";

import type {
  SandboxRuntimeAttachment,
  SandboxRuntimeAttachmentStore,
} from "../sandbox-runtime-attachment-store.js";
import type { ValkeyClient } from "../valkey-client.js";

const SandboxRuntimeAttachmentRecordSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    ownerLeaseId: z.string().min(1),
    nodeId: z.string().min(1),
    sessionId: z.string().min(1),
    attachedAtMs: z.number().int().nonnegative(),
  })
  .strict();

const ClearAttachmentScript = `
local current = redis.call('GET', KEYS[1])
if not current then
  return 0
end

local currentRecord = cjson.decode(current)
if currentRecord["ownerLeaseId"] ~= ARGV[1] then
  return 0
end

redis.call('DEL', KEYS[1])
return 1
`;

type SandboxRuntimeAttachmentRecord = z.infer<typeof SandboxRuntimeAttachmentRecordSchema>;

function buildSandboxAttachmentKey(input: {
  keyPrefix: string;
  sandboxInstanceId: string;
}): string {
  return `${input.keyPrefix}:sandbox-attachment:${input.sandboxInstanceId}`;
}

function parseSandboxRuntimeAttachmentRecord(json: string): SandboxRuntimeAttachmentRecord {
  return SandboxRuntimeAttachmentRecordSchema.parse(JSON.parse(json));
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
 * Valkey-backed runtime attachment store for distributed gateway mode.
 *
 * Attachment records are refreshed with TTL and cleared atomically only when
 * the current record still matches the caller's `ownerLeaseId`.
 */
export class ValkeySandboxRuntimeAttachmentStore implements SandboxRuntimeAttachmentStore {
  constructor(
    private readonly client: ValkeyClient,
    private readonly keyPrefix: string,
  ) {}

  async upsertAttachment(
    input: SandboxRuntimeAttachment & {
      ttlMs: number;
      nowMs: number;
    },
  ): Promise<void> {
    void input.nowMs;

    await this.client.set(
      buildSandboxAttachmentKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      JSON.stringify({
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: input.ownerLeaseId,
        nodeId: input.nodeId,
        sessionId: input.sessionId,
        attachedAtMs: input.attachedAtMs,
      }),
      {
        PX: input.ttlMs,
      },
    );
  }

  async getAttachment(input: {
    sandboxInstanceId: string;
    nowMs: number;
  }): Promise<SandboxRuntimeAttachment | null> {
    void input.nowMs;

    const attachmentJson = await this.client.get(
      buildSandboxAttachmentKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
    );
    if (attachmentJson === null) {
      return null;
    }

    return parseSandboxRuntimeAttachmentRecord(attachmentJson);
  }

  async clearAttachment(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
  }): Promise<boolean> {
    const result = await this.client.sendCommand([
      "EVAL",
      ClearAttachmentScript,
      "1",
      buildSandboxAttachmentKey({
        keyPrefix: this.keyPrefix,
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      input.ownerLeaseId,
    ]);

    return parseEvalBooleanResult(result);
  }
}
