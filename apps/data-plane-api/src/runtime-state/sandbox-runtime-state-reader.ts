export type SandboxRuntimeAttachment = {
  sandboxInstanceId: string;
  ownerLeaseId: string;
  nodeId: string;
  sessionId: string;
  attachedAtMs: number;
};

export type SandboxRuntimeStateSnapshot = {
  ownerLeaseId: string | null;
  attachment: SandboxRuntimeAttachment | null;
};

/**
 * Reads the latest gateway-owned runtime-state snapshot for one sandbox.
 *
 * Data-plane API uses this to compose user-facing sandbox status from durable
 * lifecycle state plus live gateway attachment state.
 */
export interface SandboxRuntimeStateReader {
  /**
   * Returns the current owner/attachment snapshot for one sandbox.
   */
  readSnapshot(input: {
    sandboxInstanceId: string;
    nowMs: number;
  }): Promise<SandboxRuntimeStateSnapshot>;
}
