import type { Clock, Scheduler, TimerHandle } from "@mistle/time";

import { logger } from "../logger.js";
import type { SandboxActivityStore } from "../runtime-state/sandbox-activity-store.js";
import type { SandboxPresenceStore } from "../runtime-state/sandbox-presence-store.js";
import type { SandboxOwnerStore } from "../tunnel/ownership/sandbox-owner-store.js";

/**
 * Constructor dependencies for an owner-local idle controller.
 *
 * The controller is responsible for one sandbox instance and one owner lease.
 * The controller currently owns local idle and disconnect-grace timing. Stop
 * execution is wired in a later PR.
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
 * In this PR the controller only logs when idle deadlines or disconnect-grace
 * timers elapse. Stop requests are wired later, but the controller already
 * owns the timing lifecycle and disposal semantics.
 */
export class LocalSandboxIdleController implements SandboxIdleController {
  readonly sandboxInstanceId: string;
  readonly ownerLeaseId: string;

  #currentTimerHandle: TimerHandle | undefined;
  #idleDeadlineAtMs: number | undefined;
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
    this.scheduleTimer(input.nowMs + this.dependencies.disconnectGraceMs, () => {
      logger.info(
        {
          sandboxInstanceId: this.sandboxInstanceId,
          ownerLeaseId: this.ownerLeaseId,
          disconnectGraceMs: this.dependencies.disconnectGraceMs,
        },
        "Sandbox bootstrap disconnect grace elapsed; stop request wiring is not enabled yet",
      );
      this.dispose();
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
    this.#idleDeadlineAtMs = nextIdleDeadlineAtMs;
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
    const [hasActivePresence, hasActiveActivity] = await Promise.all([
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

    if (hasActivePresence || hasActiveActivity) {
      this.scheduleIdleDeadline(nowMs + this.dependencies.timeoutMs);
      return;
    }

    logger.info(
      {
        sandboxInstanceId: this.sandboxInstanceId,
        ownerLeaseId: this.ownerLeaseId,
        idleDeadlineAtMs: this.#idleDeadlineAtMs,
        timeoutMs: this.dependencies.timeoutMs,
      },
      "Sandbox idle deadline elapsed; stop request wiring is not enabled yet",
    );

    this.scheduleIdleDeadline(nowMs + this.dependencies.timeoutMs);
  }
}
