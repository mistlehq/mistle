import type { SandboxRuntimeStateSnapshot } from "./sandbox-runtime-state-reader.js";

/**
 * Returns `true` when runtime state shows both a fenced bootstrap attachment
 * and a runtime session that has finished adapter-level initialization.
 */
export function isSandboxRuntimeReady(snapshot: SandboxRuntimeStateSnapshot): boolean {
  if (snapshot.ownerLeaseId === null) {
    return false;
  }

  if (snapshot.attachment?.ownerLeaseId !== snapshot.ownerLeaseId) {
    return false;
  }

  return snapshot.runtime.ready;
}
