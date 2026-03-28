/**
 * A gateway-owned reconciliation reason for sandbox lifecycle recovery.
 */
export type SandboxReconcileReason = "disconnect_grace_elapsed";

/**
 * Requests sandbox lifecycle reconciliation through the worker-owned boundary.
 *
 * Implementations must preserve the caller-supplied idempotency key and fence
 * the reconcile request with `expectedOwnerLeaseId`.
 */
export interface ReconcileSandboxRequester {
  /**
   * Requests that the sandbox be reconciled if the fence is still valid.
   */
  requestReconcile(input: {
    sandboxInstanceId: string;
    reason: SandboxReconcileReason;
    expectedOwnerLeaseId: string;
    idempotencyKey: string;
  }): Promise<void>;
}
