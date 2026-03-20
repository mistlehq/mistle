/**
 * A stop reason that can be requested by gateway-owned idle control.
 */
export type SandboxStopReason = "idle" | "disconnected";

/**
 * Requests a sandbox stop through the worker-owned lifecycle boundary.
 *
 * Implementations must preserve the caller-supplied idempotency key and fence
 * the stop request with `expectedOwnerLeaseId`.
 */
export interface StopSandboxRequester {
  /**
   * Requests that the sandbox be stopped if the fence is still valid.
   */
  requestStop(input: {
    sandboxInstanceId: string;
    stopReason: SandboxStopReason;
    expectedOwnerLeaseId: string;
    idempotencyKey: string;
  }): Promise<void>;
}
