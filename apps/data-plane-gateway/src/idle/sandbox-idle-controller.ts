import type { Clock, Scheduler, TimerHandle } from "@mistle/time";

import { logger } from "../logger.js";
import type { SandboxActivityStore } from "../runtime-state/sandbox-activity-store.js";
import type { SandboxPresenceStore } from "../runtime-state/sandbox-presence-store.js";
import type { SandboxRuntimeAttachmentStore } from "../runtime-state/sandbox-runtime-attachment-store.js";
import type { SandboxOwnerStore } from "../tunnel/ownership/sandbox-owner-store.js";
import type { StopSandboxRequester } from "./stop-sandbox-requester.js";

/**
 * Constructor dependencies for an owner-local idle controller.
 *
 * The controller is responsible for one sandbox instance and one fenced owner
 * lease, including local idle timing, disconnect-grace handling, and stop
 * request initiation.
 */
export type SandboxIdleControllerDependencies = {
  sandboxInstanceId: string;
  ownerLeaseId: string;
  timeoutMs: number;
  disconnectGraceMs: number;
  clock: Clock;
  scheduler: Scheduler;
  ownerStore: SandboxOwnerStore;
  activityStore: SandboxActivityStore;
  presenceStore: SandboxPresenceStore;
  runtimeAttachmentStore: SandboxRuntimeAttachmentStore;
  stopRequester: StopSandboxRequester;
};

/**
 * Owns idle timing and disconnect-grace handling for one locally owned sandbox.
 *
 * Controllers are local runtime objects rather than distributed records. A
 * controller must never request a stop using a different `ownerLeaseId` than
 * the one it was created with.
 */
export interface SandboxIdleController {
  /**
   * The sandbox instance controlled by this controller.
   */
  readonly sandboxInstanceId: string;

  /**
   * The owner lease that fenced this controller instance.
   */
  readonly ownerLeaseId: string;

  /**
   * Starts the controller and schedules its initial idle deadline.
   */
  start(input: { nowMs: number }): void;

  /**
   * Handles a presence lease creation or renewal for the same sandbox.
   */
  handlePresenceLeaseTouch(input: { leaseId: string; nowMs: number }): void;

  /**
   * Handles an activity lease creation or renewal for the same sandbox.
   */
  handleActivityLeaseTouch(input: { leaseId: string; nowMs: number }): void;

  /**
   * Transitions the controller into its disconnect-grace path.
   */
  handleBootstrapDisconnect(input: { nowMs: number }): void;

  /**
   * Makes the controller inert because the sandbox has already stopped.
   */
  handleSandboxStopped(): void;

  /**
   * Cancels controller-local timers and makes later handler calls no-ops.
   *
   * Implementations must not release owner leases, clear presence or activity
   * leases, clear runtime attachment, or mutate durable sandbox state here.
   */
  dispose(): void;
}

/**
 * Callback invoked when a controller disposes itself and should be removed from
 * the local registry.
 */
export type SandboxIdleControllerDisposeHandler = () => void;

/**
 * Owner-local idle controller that manages one in-memory timer chain.
 *
 * The controller owns idle timing, disconnect-grace timing, and fenced stop
 * requests for one currently owned sandbox instance.
 */
export class LocalSandboxIdleController implements SandboxIdleController {
  readonly sandboxInstanceId: string;
  readonly ownerLeaseId: string;

  #currentTimerHandle: TimerHandle | undefined;
  #inDisconnectGracePath = false;
  #disposed = false;

  constructor(
    private readonly dependencies: SandboxIdleControllerDependencies,
    private readonly onDispose: SandboxIdleControllerDisposeHandler,
  ) {
    this.sandboxInstanceId = dependencies.sandboxInstanceId;
    this.ownerLeaseId = dependencies.ownerLeaseId;
  }

  start(input: { nowMs: number }): void {
    if (this.#disposed || this.#inDisconnectGracePath) {
      return;
    }

    this.scheduleIdleDeadline(input.nowMs + this.dependencies.timeoutMs);
  }

  handlePresenceLeaseTouch(input: { leaseId: string; nowMs: number }): void {
    void input.leaseId;

    if (this.#disposed || this.#inDisconnectGracePath) {
      return;
    }

    this.scheduleIdleDeadline(input.nowMs + this.dependencies.timeoutMs);
  }

  handleActivityLeaseTouch(input: { leaseId: string; nowMs: number }): void {
    void input.leaseId;

    if (this.#disposed || this.#inDisconnectGracePath) {
      return;
    }

    this.scheduleIdleDeadline(input.nowMs + this.dependencies.timeoutMs);
  }

  handleBootstrapDisconnect(input: { nowMs: number }): void {
    if (this.#disposed || this.#inDisconnectGracePath) {
      return;
    }

    this.#inDisconnectGracePath = true;
    this.cancelCurrentTimer();
    void this.dependencies.runtimeAttachmentStore
      .clearAttachment({
        sandboxInstanceId: this.sandboxInstanceId,
        ownerLeaseId: this.ownerLeaseId,
      })
      .catch((error: unknown) => {
        logger.error(
          {
            err: error,
            sandboxInstanceId: this.sandboxInstanceId,
            ownerLeaseId: this.ownerLeaseId,
          },
          "Failed to clear fenced runtime attachment on bootstrap disconnect",
        );
      });
    this.scheduleTimer(input.nowMs + this.dependencies.disconnectGraceMs, () => {
      void this.handleDisconnectGraceElapsed();
    });
  }

  handleSandboxStopped(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.cancelCurrentTimer();
    this.onDispose();
  }

  private scheduleIdleDeadline(nextIdleDeadlineAtMs: number): void {
    this.scheduleTimer(nextIdleDeadlineAtMs, () => {
      void this.handleIdleDeadlineElapsed();
    });
  }

  private scheduleTimer(dueMs: number, callback: () => void): void {
    this.cancelCurrentTimer();

    const delayMs = Math.max(0, dueMs - this.dependencies.clock.nowMs());
    this.#currentTimerHandle = this.dependencies.scheduler.schedule(() => {
      callback();
    }, delayMs);
  }

  private cancelCurrentTimer(): void {
    if (this.#currentTimerHandle === undefined) {
      return;
    }

    this.dependencies.scheduler.cancel(this.#currentTimerHandle);
    this.#currentTimerHandle = undefined;
  }

  private async handleIdleDeadlineElapsed(): Promise<void> {
    const nowMs = this.dependencies.clock.nowMs();
    const [currentOwner, hasActivePresence, hasActiveActivity] = await Promise.all([
      this.dependencies.ownerStore.getOwner({
        sandboxInstanceId: this.sandboxInstanceId,
      }),
      this.dependencies.presenceStore.hasAnyActiveLease({
        sandboxInstanceId: this.sandboxInstanceId,
        nowMs,
      }),
      this.dependencies.activityStore.hasAnyActiveLease({
        sandboxInstanceId: this.sandboxInstanceId,
        nowMs,
      }),
    ]);

    if (this.#disposed || this.#inDisconnectGracePath) {
      return;
    }

    if (currentOwner?.leaseId !== this.ownerLeaseId) {
      this.dispose();
      return;
    }

    if (hasActivePresence || hasActiveActivity) {
      this.scheduleIdleDeadline(nowMs + this.dependencies.timeoutMs);
      return;
    }

    try {
      await this.dependencies.stopRequester.requestStop({
        sandboxInstanceId: this.sandboxInstanceId,
        stopReason: "idle",
        expectedOwnerLeaseId: this.ownerLeaseId,
        idempotencyKey: this.createStopIdempotencyKey("idle"),
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          sandboxInstanceId: this.sandboxInstanceId,
          ownerLeaseId: this.ownerLeaseId,
        },
        "Failed to request fenced idle sandbox stop",
      );
      return;
    }

    this.dispose();
  }

  private async handleDisconnectGraceElapsed(): Promise<void> {
    const nowMs = this.dependencies.clock.nowMs();
    const [currentOwner, currentAttachment] = await Promise.all([
      this.dependencies.ownerStore.getOwner({
        sandboxInstanceId: this.sandboxInstanceId,
      }),
      this.dependencies.runtimeAttachmentStore.getAttachment({
        sandboxInstanceId: this.sandboxInstanceId,
        nowMs,
      }),
    ]);

    if (this.#disposed || !this.#inDisconnectGracePath) {
      return;
    }

    if (currentAttachment?.ownerLeaseId === this.ownerLeaseId) {
      this.#inDisconnectGracePath = false;
      this.scheduleIdleDeadline(nowMs + this.dependencies.timeoutMs);
      return;
    }

    if (currentOwner?.leaseId !== undefined && currentOwner.leaseId !== this.ownerLeaseId) {
      this.dispose();
      return;
    }

    if (currentAttachment !== null) {
      this.dispose();
      return;
    }

    try {
      await this.dependencies.stopRequester.requestStop({
        sandboxInstanceId: this.sandboxInstanceId,
        stopReason: "disconnected",
        expectedOwnerLeaseId: this.ownerLeaseId,
        idempotencyKey: this.createStopIdempotencyKey("disconnected"),
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          sandboxInstanceId: this.sandboxInstanceId,
          ownerLeaseId: this.ownerLeaseId,
        },
        "Failed to request fenced disconnected sandbox stop",
      );
      return;
    }

    this.dispose();
  }

  private createStopIdempotencyKey(stopReason: "idle" | "disconnected"): string {
    return `${this.sandboxInstanceId}:${this.ownerLeaseId}:${stopReason}`;
  }
}
