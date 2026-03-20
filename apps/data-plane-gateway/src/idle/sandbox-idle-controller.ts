import type { Clock, Scheduler } from "@mistle/time";

import type { SandboxActivityStore } from "../runtime-state/sandbox-activity-store.js";
import type { SandboxPresenceStore } from "../runtime-state/sandbox-presence-store.js";
import type { SandboxOwnerStore } from "../tunnel/ownership/sandbox-owner-store.js";
import type { StopSandboxRequester } from "./stop-sandbox-requester.js";

/**
 * Constructor dependencies for an owner-local idle controller.
 *
 * The controller is responsible for one sandbox instance and one owner lease.
 * A later implementation will use these dependencies to reschedule idle checks,
 * validate ownership before stop requests, and route stop intents through the
 * worker-owned stop boundary.
 */
export type SandboxIdleControllerDependencies = {
  sandboxInstanceId: string;
  ownerLeaseId: string;
  timeoutMs: number;
  disconnectGraceMs: number;
  clock: Clock;
  scheduler: Scheduler;
  ownerStore: SandboxOwnerStore;
  presenceStore: SandboxPresenceStore;
  activityStore: SandboxActivityStore;
  stopSandboxRequester: StopSandboxRequester;
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
