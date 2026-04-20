import type { SandboxRuntimeStateSnapshot } from "./sandbox-runtime-state-reader.js";

/**
 * Returns `true` when runtime state shows a fenced bootstrap attachment that
 * matches the current owner lease, regardless of adapter readiness.
 */
export function isSandboxRuntimeAttached(snapshot: SandboxRuntimeStateSnapshot): boolean {
  if (snapshot.ownerLeaseId === null) {
    return false;
  }

  return snapshot.attachment?.ownerLeaseId === snapshot.ownerLeaseId;
}

/**
 * Returns `true` when runtime state shows both a fenced bootstrap attachment
 * and a runtime session that has finished adapter-level initialization.
 */
export function isSandboxRuntimeReady(snapshot: SandboxRuntimeStateSnapshot): boolean {
  if (!isSandboxRuntimeAttached(snapshot)) {
    return false;
  }

  return snapshot.runtime.ready;
}
