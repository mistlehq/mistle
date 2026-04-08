/**
 * Stores the owner-fenced runtime-readiness projection for sandbox instances.
 */
export interface SandboxRuntimeReadinessStore {
  /**
   * Replaces the current runtime-readiness state for one sandbox owner lease.
   */
  replaceStateForOwner(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
    nodeId: string;
    ready: boolean;
  }): Promise<void>;

  /**
   * Returns the runtime-readiness summary visible to the current sandbox owner.
   */
  summarize(input: { sandboxInstanceId: string; ownerLeaseId: string | null }): Promise<{
    ready: boolean;
  }>;
}
