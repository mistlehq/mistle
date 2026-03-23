import type { SandboxRuntimeStateSnapshot } from "./sandbox-runtime-state-reader.js";

/**
 * Returns `true` when runtime state shows a live bootstrap owner and a
 * matching fenced attachment for the same sandbox.
 */
export function isSandboxRuntimeReady(snapshot: SandboxRuntimeStateSnapshot): boolean {
  if (snapshot.ownerLeaseId === null) {
    return false;
  }

  return snapshot.attachment?.ownerLeaseId === snapshot.ownerLeaseId;
}
