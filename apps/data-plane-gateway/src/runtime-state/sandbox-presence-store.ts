/**
 * The product surface that originated a presence lease.
 *
 * The stop policy should generally not branch on this field. It exists so the
 * system can preserve origin information for telemetry and debugging.
 */
export type SandboxPresenceLeaseSource = "dashboard" | "cli";

/**
 * Stores interactive client presence leases for sandbox instances.
 *
 * Presence is non-exclusive: many interactive sessions may keep the same
 * sandbox alive concurrently. Leases are intentionally session-scoped rather
 * than stream-scoped, so a connected interactive websocket may keep a sandbox
 * alive even when it currently has no open streams. Implementations should
 * treat `touchLease(...)` as an upsert-like operation that creates a missing
 * lease or extends an existing one.
 */
export interface SandboxPresenceStore {
  /**
   * Creates or renews a presence lease until `nowMs + ttlMs`.
   */
  touchLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    source: SandboxPresenceLeaseSource;
    sessionId: string;
    ttlMs: number;
    nowMs: number;
  }): Promise<void>;

  /**
   * Explicitly releases a presence lease.
   *
   * Returns `false` when the lease no longer exists.
   */
  releaseLease(input: { sandboxInstanceId: string; leaseId: string }): Promise<boolean>;

  /**
   * Returns whether at least one live presence lease exists for the sandbox.
   */
  hasAnyActiveLease(input: { sandboxInstanceId: string; nowMs: number }): Promise<boolean>;
}
