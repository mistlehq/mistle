import type { Clock } from "@mistle/time";

import { recordGatewayForwardingReadinessChangedEvent } from "../tunnel/gateway-relay-observability.js";

type GatewayForwardingReadinessBackend = "memory" | "nats";

export type GatewayForwardingReadinessStatus =
  /** Forwarding must not be used. The gateway has not started, is stopping, or lost its subscription/check. */
  | "not_ready"
  /** Forwarding has a local subscription and is waiting for a NATS request check to succeed. */
  | "checking"
  /** A NATS request to this gateway's forwarding subject succeeded. */
  | "ready";

export type GatewayForwardingReadinessReason =
  /** In-memory forwarding is local to the process and does not need a NATS request check. */
  | "local_backend"
  /** Initial state before the forwarding adapter has started. */
  | "startup"
  /** The initial NATS request check failed before startup could finish. */
  | "startup_check_failed"
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
  lastCheckAtMs: number | undefined;
  reason: GatewayForwardingReadinessReason;
  status: GatewayForwardingReadinessStatus;
};

export type GatewayForwardingReadinessSnapshot = Omit<
  GatewayForwardingReadinessState,
  "lastCheckAtMs"
> & {
  lastCheckAtMs: number | null;
  nodeId: string;
  subject: string;
};

export class GatewayForwardingReadiness {
  private state: GatewayForwardingReadinessState;

  public constructor(
    private readonly input: {
      backend: GatewayForwardingReadinessBackend;
      clock: Clock;
      localNodeId: string;
      subject: string;
    },
  ) {
    this.state = {
      changedAtMs: this.input.clock.nowMs(),
      lastCheckAtMs: undefined,
      reason: "startup",
      status: "not_ready",
    };
  }

  public getState(): GatewayForwardingReadinessState {
    return this.state;
  }

  public getSnapshot(): GatewayForwardingReadinessSnapshot {
    return {
      ...this.state,
      lastCheckAtMs: this.state.lastCheckAtMs ?? null,
      nodeId: this.input.localNodeId,
      subject: this.input.subject,
    };
  }

  public isReady(): boolean {
    return this.state.status === "ready";
  }

  public markChecking(input: { reason: GatewayForwardingReadinessReason }): void {
    this.transition({
      changedAtMs: this.input.clock.nowMs(),
      lastCheckAtMs: this.state.lastCheckAtMs,
      reason: input.reason,
      status: "checking",
    });
  }

  public markReady(input: { reason: GatewayForwardingReadinessReason }): void {
    const changedAtMs = this.input.clock.nowMs();
    this.transition({
      changedAtMs,
      lastCheckAtMs:
        input.reason === "self_check_succeeded" ? changedAtMs : this.state.lastCheckAtMs,
      reason: input.reason,
      status: "ready",
    });
  }

  public markNotReady(input: { error?: unknown; reason: GatewayForwardingReadinessReason }): void {
    const changedAtMs = this.input.clock.nowMs();
    this.transition(
      {
        changedAtMs,
        lastCheckAtMs:
          input.reason === "self_check_failed" ? changedAtMs : this.state.lastCheckAtMs,
        reason: input.reason,
        status: "not_ready",
      },
      input.error,
    );
  }

  private transition(nextState: GatewayForwardingReadinessState, error?: unknown): void {
    const previousState = this.state;
    if (previousState.status === nextState.status && previousState.reason === nextState.reason) {
      this.state = {
        ...nextState,
        changedAtMs: previousState.changedAtMs,
      };
      return;
    }

    this.state = nextState;
    recordGatewayForwardingReadinessChangedEvent({
      backend: this.input.backend,
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
