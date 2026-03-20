/**
 * A worker-readable record of the current bootstrap attachment for a sandbox.
 *
 * This record is derived from an active bootstrap connection. It is not a
 * second source of truth for ownership and must remain fenced by the owner
 * lease that established it.
 */
export type SandboxRuntimeAttachment = {
  sandboxInstanceId: string;
  ownerLeaseId: string;
  nodeId: string;
  sessionId: string;
  attachedAtMs: number;
};

/**
 * Stores current runtime attachment state for sandbox instances.
 *
 * Implementations must fence clears by `ownerLeaseId` so a stale owner cannot
 * remove an attachment established by a newer owner.
 */
export interface SandboxRuntimeAttachmentStore {
  /**
   * Writes or refreshes the attachment for a sandbox instance.
   */
  upsertAttachment(
    input: SandboxRuntimeAttachment & {
      ttlMs: number;
      nowMs: number;
    },
  ): Promise<void>;

  /**
   * Reads the current attachment, or `null` when none exists or it has expired.
   */
  getAttachment(input: {
    sandboxInstanceId: string;
    nowMs: number;
  }): Promise<SandboxRuntimeAttachment | null>;

  /**
   * Clears the current attachment if it is still fenced to `ownerLeaseId`.
   *
   * Returns `false` when no matching attachment was cleared.
   */
  clearAttachment(input: { sandboxInstanceId: string; ownerLeaseId: string }): Promise<boolean>;
}
