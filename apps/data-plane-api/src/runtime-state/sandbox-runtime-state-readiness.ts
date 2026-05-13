import type { SandboxRuntimeStateSnapshot } from "./sandbox-runtime-state-reader.js";

/**
 * Returns `true` when the gateway snapshot has a fenced bootstrap tunnel
 * attachment for the current owner lease. This only proves sandboxd is
 * attached to the gateway; it does not prove runtime initialization has
 * completed.
 */
export function isSandboxBootstrapAttached(snapshot: SandboxRuntimeStateSnapshot): boolean {
  if (snapshot.ownerLeaseId === null) {
    return false;
  }

  return snapshot.attachment?.ownerLeaseId === snapshot.ownerLeaseId;
}

/**
 * Returns `true` when the sandbox has a fenced bootstrap attachment and the
 * runtime has finished adapter-level initialization.
 */
export function isSandboxRuntimeReady(snapshot: SandboxRuntimeStateSnapshot): boolean {
  if (!isSandboxBootstrapAttached(snapshot)) {
    return false;
  }

  return snapshot.runtime.ready;
}
