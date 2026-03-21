import type { Clock } from "@mistle/time";

import { logger } from "../../logger.js";
import type {
  SandboxRuntimeAttachment,
  SandboxRuntimeAttachmentStore,
} from "../sandbox-runtime-attachment-store.js";

type InMemoryAttachmentRecord = {
  attachment: SandboxRuntimeAttachment;
  expiresAtMs: number;
};

/**
 * Gateway-local runtime attachment store used in single-node `memory` mode.
 *
 * Attachment state expires in memory and is lost on process restart. Clears are
 * fenced by `ownerLeaseId` so a stale owner cannot remove a newer attachment.
 */
export class InMemorySandboxRuntimeAttachmentStore implements SandboxRuntimeAttachmentStore {
  readonly #attachmentsBySandboxInstanceId = new Map<string, InMemoryAttachmentRecord>();

  constructor(private readonly clock: Clock) {}

  async upsertAttachment(
    input: SandboxRuntimeAttachment & {
      ttlMs: number;
      nowMs: number;
    },
  ): Promise<void> {
    void input.nowMs;

    this.#attachmentsBySandboxInstanceId.set(input.sandboxInstanceId, {
      attachment: {
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: input.ownerLeaseId,
        nodeId: input.nodeId,
        sessionId: input.sessionId,
        attachedAtMs: input.attachedAtMs,
      },
      expiresAtMs: this.clock.nowMs() + input.ttlMs,
    });
    logger.debug(
      {
        event: "sandbox_runtime_attachment_upserted",
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: input.ownerLeaseId,
        nodeId: input.nodeId,
        sessionId: input.sessionId,
        attachedAtMs: input.attachedAtMs,
        ttlMs: input.ttlMs,
      },
      "Upserted sandbox runtime attachment",
    );
  }

  async getAttachment(input: {
    sandboxInstanceId: string;
    nowMs: number;
  }): Promise<SandboxRuntimeAttachment | null> {
    void input.nowMs;

    const currentRecord = this.#attachmentsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (currentRecord === undefined) {
      return null;
    }

    if (currentRecord.expiresAtMs > this.clock.nowMs()) {
      return currentRecord.attachment;
    }

    this.#attachmentsBySandboxInstanceId.delete(input.sandboxInstanceId);
    return null;
  }

  async clearAttachment(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
  }): Promise<boolean> {
    const currentRecord = await this.getAttachment({
      sandboxInstanceId: input.sandboxInstanceId,
      nowMs: this.clock.nowMs(),
    });
    if (currentRecord === null) {
      logger.debug(
        {
          event: "sandbox_runtime_attachment_clear_rejected",
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.ownerLeaseId,
          reason: "missing_attachment",
        },
        "Rejected sandbox runtime attachment clear",
      );
      return false;
    }
    if (currentRecord.ownerLeaseId !== input.ownerLeaseId) {
      logger.debug(
        {
          event: "sandbox_runtime_attachment_clear_rejected",
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.ownerLeaseId,
          currentOwnerLeaseId: currentRecord.ownerLeaseId,
          reason: "stale_owner",
        },
        "Rejected sandbox runtime attachment clear",
      );
      return false;
    }

    this.#attachmentsBySandboxInstanceId.delete(input.sandboxInstanceId);
    logger.debug(
      {
        event: "sandbox_runtime_attachment_cleared",
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: input.ownerLeaseId,
      },
      "Cleared sandbox runtime attachment",
    );
    return true;
  }
}
