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

/**
 * Constructor input used when the local registry creates a new controller.
 */
export type SandboxIdleControllerFactoryInput = {
  sandboxInstanceId: string;
  ownerLeaseId: string;
  onDisposed: () => void;
};

/**
 * Gateway-local registry for idle controllers.
 *
 * The registry keeps at most one controller per sandbox. When a new owner
 * lease takes over the same sandbox, the old controller is disposed before the
 * replacement is installed.
 */
export class InMemorySandboxIdleControllerRegistry implements SandboxIdleControllerRegistry {
  readonly #controllersBySandboxInstanceId = new Map<string, SandboxIdleController>();

  constructor(
    private readonly createController: (
      input: SandboxIdleControllerFactoryInput,
    ) => SandboxIdleController,
  ) {}

  ensureController(input: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
    nowMs: number;
  }): SandboxIdleController {
    void input.nowMs;

    const currentController = this.#controllersBySandboxInstanceId.get(input.sandboxInstanceId);
    if (currentController !== undefined && currentController.ownerLeaseId === input.ownerLeaseId) {
      return currentController;
    }

    currentController?.dispose();

    const nextController = this.createController({
      sandboxInstanceId: input.sandboxInstanceId,
      ownerLeaseId: input.ownerLeaseId,
      onDisposed: () => {
        const latestController = this.#controllersBySandboxInstanceId.get(input.sandboxInstanceId);
        if (latestController?.ownerLeaseId === input.ownerLeaseId) {
          this.#controllersBySandboxInstanceId.delete(input.sandboxInstanceId);
        }
      },
    });

    this.#controllersBySandboxInstanceId.set(input.sandboxInstanceId, nextController);
    return nextController;
  }

  getController(input: { sandboxInstanceId: string }): SandboxIdleController | null {
    return this.#controllersBySandboxInstanceId.get(input.sandboxInstanceId) ?? null;
  }

  disposeController(input: {
    sandboxInstanceId: string;
    ownerLeaseId?: string;
    reason: SandboxIdleControllerDisposalReason;
  }): void {
    void input.reason;

    const currentController = this.#controllersBySandboxInstanceId.get(input.sandboxInstanceId);
    if (currentController === undefined) {
      return;
    }

    if (input.ownerLeaseId !== undefined && currentController.ownerLeaseId !== input.ownerLeaseId) {
      return;
    }

    this.#controllersBySandboxInstanceId.delete(input.sandboxInstanceId);
    currentController.dispose();
  }
}
