/**
 * A worker-readable record of the current bootstrap attachment for a sandbox.
 *
 * The worker uses this attachment together with the current owner lease to make
 * readiness and stop-fencing decisions without depending on Postgres liveliness
 * columns.
 */
export type SandboxRuntimeAttachment = {
  sandboxInstanceId: string;
  ownerLeaseId: string;
  nodeId: string;
  sessionId: string;
  attachedAtMs: number;
};

/**
 * A snapshot of the worker-visible runtime state for one sandbox instance.
 */
export type SandboxRuntimeStateSnapshot = {
  ownerLeaseId: string | null;
  attachment: SandboxRuntimeAttachment | null;
};

/**
 * Reads worker-visible runtime state regardless of the backing implementation.
 *
 * Later adapters may source this state from gateway-local memory through an
 * internal HTTP route or directly from Valkey. Worker callers should not branch
 * on the storage backend.
 */
export interface SandboxRuntimeStateReader {
  /**
   * Reads the latest runtime-state snapshot for the sandbox instance.
   */
  readSnapshot(input: {
    sandboxInstanceId: string;
    nowMs: number;
  }): Promise<SandboxRuntimeStateSnapshot>;
}
