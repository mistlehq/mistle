import type { Clock } from "@mistle/time";

import { recordGatewayForwardingReadinessChangedEvent } from "../tunnel/gateway-relay-observability.js";

export type GatewayForwardingReadinessStatus =
  /** Forwarding must not be used. The gateway has not started, is stopping, or lost its subscription/check. */
  | "not_ready"
  /** Forwarding has a local subscription and is waiting for a NATS request check to succeed. */
  | "checking"
  /** A NATS request to this gateway's forwarding subject succeeded. */
  | "ready";

export type GatewayForwardingReadinessReason =
  /** Initial state before the forwarding adapter has started. */
  | "startup"
  /** The forwarding adapter is shutting down or draining. */
  | "stopping"
  /** The local forwarding subscription was created and is being checked through NATS. */
  | "subscription_started"
  /** The async subscription loop ended, so the gateway may no longer be serving requests. */
  | "subscription_exited"
  /** The async subscription loop threw an error. */
  | "subscription_failed"
  /** A NATS request to the forwarding subject succeeded. */
  | "self_check_succeeded"
  /** A NATS request to the forwarding subject failed. */
  | "self_check_failed";

export type GatewayForwardingReadinessState = {
  changedAtMs: number;
  reason: GatewayForwardingReadinessReason;
  status: GatewayForwardingReadinessStatus;
};

export class GatewayForwardingReadiness {
  private state: GatewayForwardingReadinessState;

  public constructor(
    private readonly input: {
      clock: Clock;
      localNodeId: string;
      subject: string;
    },
  ) {
    this.state = {
      changedAtMs: this.input.clock.nowMs(),
      reason: "startup",
      status: "not_ready",
    };
  }

  public getState(): GatewayForwardingReadinessState {
    return this.state;
  }

  public isReady(): boolean {
    return this.state.status === "ready";
  }

  public markChecking(input: { reason: GatewayForwardingReadinessReason }): void {
    this.transition({
      changedAtMs: this.input.clock.nowMs(),
      reason: input.reason,
      status: "checking",
    });
  }

  public markReady(input: { reason: GatewayForwardingReadinessReason }): void {
    this.transition({
      changedAtMs: this.input.clock.nowMs(),
      reason: input.reason,
      status: "ready",
    });
  }

  public markNotReady(input: { error?: unknown; reason: GatewayForwardingReadinessReason }): void {
    this.transition(
      {
        changedAtMs: this.input.clock.nowMs(),
        reason: input.reason,
        status: "not_ready",
      },
      input.error,
    );
  }

  private transition(nextState: GatewayForwardingReadinessState, error?: unknown): void {
    const previousState = this.state;
    if (previousState.status === nextState.status && previousState.reason === nextState.reason) {
      return;
    }

    this.state = nextState;
    recordGatewayForwardingReadinessChangedEvent({
      backend: "nats",
      changedAtMs: nextState.changedAtMs,
      error,
      localNodeId: this.input.localNodeId,
      nextReason: nextState.reason,
      nextStatus: nextState.status,
      previousReason: previousState.reason,
      previousStatus: previousState.status,
      subject: this.input.subject,
    });
  }
}
