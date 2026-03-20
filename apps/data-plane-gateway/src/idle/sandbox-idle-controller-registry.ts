import type { SandboxIdleController } from "./sandbox-idle-controller.js";

/**
 * Reasons a controller may be disposed by the local registry.
 */
export type SandboxIdleControllerDisposalReason =
  | "owner_lost"
  | "bootstrap_disconnected"
  | "sandbox_stopped";

/**
 * Tracks idle controllers for sandboxes owned by the current gateway node.
 *
 * The registry is local-only. It prevents duplicate controllers for the same
 * sandbox and must not dispose a newer controller when an older owner lease is
 * being cleaned up.
 */
export interface SandboxIdleControllerRegistry {
  /**
   * Returns the current controller for the sandbox, or creates one for the
   * supplied owner lease when none exists.
   */
  ensureController(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
    nowMs: number;
  }): SandboxIdleController;

  /**
   * Returns the currently registered controller for the sandbox, if any.
   */
  getController(input: { sandboxInstanceId: string }): SandboxIdleController | null;

  /**
   * Disposes the currently registered controller when it matches the supplied
   * owner lease fence, or unconditionally when no owner lease is provided.
   */
  disposeController(input: {
    sandboxInstanceId: string;
    ownerLeaseId?: string;
    reason: SandboxIdleControllerDisposalReason;
  }): void;
}
