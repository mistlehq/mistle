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
 * Worker callers should not branch on the gateway's runtime-state storage
 * backend. The current implementation reads through an internal gateway HTTP
 * route, and later gateway-side backends may change without affecting worker
 * call sites.
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
