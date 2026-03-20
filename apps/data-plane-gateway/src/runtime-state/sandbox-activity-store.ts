/**
 * The keepalive capability represented by an activity lease.
 */
export type SandboxActivityLeaseKind = "agent_execution";

/**
 * The source that originated an activity lease.
 *
 * The wire protocol currently treats this as an open string field, so the
 * store preserves the source value rather than restricting it to a closed
 * union too early.
 */
export type SandboxActivityLeaseSource = string;

/**
 * Stores background activity leases for sandbox instances.
 *
 * Activity is non-exclusive: more than one execution source may keep the same
 * sandbox alive concurrently.
 */
export interface SandboxActivityStore {
  /**
   * Creates or fully refreshes an activity lease until `nowMs + ttlMs`.
   *
   * This path is used for protocol events that carry complete activity
   * metadata, such as `lease.create`.
   */
  touchLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    kind: SandboxActivityLeaseKind;
    source: SandboxActivityLeaseSource;
    externalExecutionId?: string;
    metadata?: Record<string, unknown>;
    nodeId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<void>;

  /**
   * Renews an existing activity lease until `nowMs + ttlMs`.
   *
   * Returns `false` when the lease does not exist. This preserves the current
   * wire-level execution-lease semantics where renewing an unknown lease should
   * not create a new one.
   */
  renewLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<boolean>;

  /**
   * Explicitly releases an activity lease.
   *
   * Returns `false` when the lease no longer exists.
   */
  releaseLease(input: { sandboxInstanceId: string; leaseId: string }): Promise<boolean>;

  /**
   * Returns whether at least one live activity lease exists for the sandbox.
   */
  hasAnyActiveLease(input: { sandboxInstanceId: string; nowMs: number }): Promise<boolean>;
}
