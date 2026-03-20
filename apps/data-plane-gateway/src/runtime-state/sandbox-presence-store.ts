/**
 * The keepalive capability represented by a presence lease.
 *
 * `pty` is a terminal-style interactive session. `agent` is an interactive
 * agent session that should keep the sandbox alive while connected.
 */
export type SandboxPresenceLeaseKind = "pty" | "agent";

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
 * sandbox alive concurrently. Implementations should treat `touchLease(...)` as
 * an upsert-like operation that creates a missing lease or extends an existing
 * one.
 */
export interface SandboxPresenceStore {
  /**
   * Creates or renews a presence lease until `nowMs + ttlMs`.
   */
  touchLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    kind: SandboxPresenceLeaseKind;
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
