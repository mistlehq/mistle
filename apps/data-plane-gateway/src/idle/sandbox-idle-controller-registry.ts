import { logger } from "../logger.js";
import type { SandboxIdleController } from "./sandbox-idle-controller.js";

/**
 * Reasons a controller may be disposed by the local registry.
 */
export type SandboxIdleControllerDisposalReason =
  | "owner_lost"
  | "bootstrap_disconnected"
  | "sandbox_stopped";

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
export class SandboxIdleControllerRegistry {
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
    const currentController = this.#controllersBySandboxInstanceId.get(input.sandboxInstanceId);
    if (currentController !== undefined && currentController.ownerLeaseId === input.ownerLeaseId) {
      return currentController;
    }

    if (currentController !== undefined) {
      logger.info(
        {
          event: "sandbox_idle_controller_replaced",
          sandboxInstanceId: input.sandboxInstanceId,
          previousOwnerLeaseId: currentController.ownerLeaseId,
          ownerLeaseId: input.ownerLeaseId,
          nowMs: input.nowMs,
        },
        "Replacing sandbox idle controller for new owner lease",
      );
      currentController.dispose();
    }

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
    logger.info(
      {
        event: "sandbox_idle_controller_created",
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: input.ownerLeaseId,
        nowMs: input.nowMs,
      },
      "Created sandbox idle controller",
    );
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
    const currentController = this.#controllersBySandboxInstanceId.get(input.sandboxInstanceId);
    if (currentController === undefined) {
      return;
    }

    if (input.ownerLeaseId !== undefined && currentController.ownerLeaseId !== input.ownerLeaseId) {
      return;
    }

    this.#controllersBySandboxInstanceId.delete(input.sandboxInstanceId);
    logger.info(
      {
        event: "sandbox_idle_controller_disposed",
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: currentController.ownerLeaseId,
        reason: input.reason,
      },
      "Disposed sandbox idle controller",
    );
    currentController.dispose();
  }
}
