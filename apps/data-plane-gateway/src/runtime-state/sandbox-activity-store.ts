/**
 * The keepalive capability represented by an activity lease.
 */
export type SandboxActivityLeaseKind = "agent_execution";

/**
 * The source that originated an activity lease.
 */
export type SandboxActivityLeaseSource = "webhook" | "dashboard" | "system";

/**
 * Stores background activity leases for sandbox instances.
 *
 * Activity is non-exclusive: more than one execution source may keep the same
 * sandbox alive concurrently. Implementations should treat `touchLease(...)` as
 * an upsert-like operation that creates a missing lease or extends an existing
 * one.
 */
export interface SandboxActivityStore {
  /**
   * Creates or renews an activity lease until `nowMs + ttlMs`.
   */
  touchLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    kind: SandboxActivityLeaseKind;
    source: SandboxActivityLeaseSource;
    ttlMs: number;
    nowMs: number;
  }): Promise<void>;

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
