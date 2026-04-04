/**
 * The source that originated a keepalive record.
 *
 * The current legacy execution-lease protocol treats this as an open string
 * field, so the store preserves the source value rather than restricting it to
 * a closed union too early.
 */
export type SandboxKeepaliveSource = string;

/**
 * Stores background keepalive records for sandbox instances.
 *
 * During the migration stack, legacy execution leases are translated into
 * generic keepalive records keyed by `keepaliveId`. Callers that only need the
 * idle-control projection should consume `summarize(...)`.
 */
export interface SandboxKeepaliveStore {
  /**
   * Creates or fully refreshes one keepalive record until `nowMs + ttlMs`.
   */
  touchKeepalive(input: {
    sandboxInstanceId: string;
    keepaliveId: string;
    source: SandboxKeepaliveSource;
    externalSubjectId?: string;
    metadata?: Record<string, unknown>;
    nodeId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<void>;

  /**
   * Renews an existing keepalive record until `nowMs + ttlMs`.
   *
   * Returns `false` when the keepalive record does not exist.
   */
  renewKeepalive(input: {
    sandboxInstanceId: string;
    keepaliveId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<boolean>;

  /**
   * Explicitly releases a keepalive record.
   *
   * Returns `false` when the record no longer exists.
   */
  releaseKeepalive(input: { sandboxInstanceId: string; keepaliveId: string }): Promise<boolean>;

  /**
   * Returns the current coarse keepalive summary for one sandbox instance.
   */
  summarize(input: { sandboxInstanceId: string; nowMs: number }): Promise<{
    active: boolean;
  }>;
}
