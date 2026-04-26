import type { SandboxOwner } from "./types.js";

/**
 * Stores the fenced owner lease used to coordinate bootstrap activation and
 * exclusivity across gateway nodes.
 *
 * The visible active bootstrap session lives in runtime attachment state. This
 * lease store exists to prevent concurrent bootstrap activation races and must
 * fence renew and release operations by `leaseId` so a stale owner cannot
 * mutate a newer lease.
 */
export interface SandboxOwnerStore {
  /**
   * Claims ownership for a sandbox instance and returns the new fenced lease.
   */
  claimOwner(input: {
    leaseId?: string;
    sandboxInstanceId: string;
    nodeId: string;
    sessionId: string;
    ttlMs: number;
  }): Promise<SandboxOwner>;
  /**
   * Renews an existing owner lease.
   *
   * Returns `false` when the lease is no longer current for the sandbox.
   */
  renewOwnerLease(input: {
    sandboxInstanceId: string;
    leaseId: string;
    ttlMs: number;
  }): Promise<boolean>;
  /**
   * Reads the current owner lease, if any.
   */
  getOwner(input: { sandboxInstanceId: string }): Promise<SandboxOwner | undefined>;
  /**
   * Releases the current owner lease.
   *
   * Returns `false` when the supplied lease is stale and was not released.
   */
  releaseOwner(input: { sandboxInstanceId: string; leaseId: string }): Promise<boolean>;
}
