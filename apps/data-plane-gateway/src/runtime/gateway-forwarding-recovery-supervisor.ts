import type { Clock, Scheduler, TimerHandle } from "@mistle/time";

import { logger } from "../logger.js";
import type {
  GatewayForwardingReadiness,
  GatewayForwardingReadinessState,
} from "./gateway-forwarding-readiness.js";

const DefaultMaxConsecutiveCheckFailures = 3;
const DefaultNotReadyReplacementDelayMs = 90_000;

export type GatewayForwardingReplacementReason =
  | "forwarding_check_failure_threshold"
  | "forwarding_not_ready_timeout";

export class GatewayForwardingRecoverySupervisor {
  private notReadyReplacementTimer: TimerHandle | undefined;
  private stopReadinessListener: (() => void) | undefined;
  private terminated = false;

  public constructor(
    private readonly input: {
      clock: Clock;
      isDraining: () => boolean;
      localNodeId: string;
      maxConsecutiveCheckFailures?: number;
      notReadyReplacementDelayMs?: number;
      readiness: GatewayForwardingReadiness;
      scheduler: Scheduler;
      terminate: (reason: GatewayForwardingReplacementReason) => void;
    },
  ) {}

  public start(): void {
    if (this.stopReadinessListener !== undefined) {
      throw new Error("Gateway forwarding recovery supervisor is already started.");
    }

    this.stopReadinessListener = this.input.readiness.subscribe((state) => {
      this.handleReadinessState(state);
    });
    this.handleReadinessState(this.input.readiness.getState());
  }

  public stop(): void {
    this.cancelNotReadyReplacementTimer();
    this.stopReadinessListener?.();
    this.stopReadinessListener = undefined;
  }

  private handleReadinessState(state: GatewayForwardingReadinessState): void {
    if (this.terminated || this.input.isDraining()) {
      return;
    }
    if (state.consecutiveFailedChecks >= this.maxConsecutiveCheckFailures()) {
      this.terminate("forwarding_check_failure_threshold");
      return;
    }
    if (state.status !== "not_ready") {
      this.cancelNotReadyReplacementTimer();
      return;
    }

    const notReadySinceMs = state.notReadySinceMs;
    if (notReadySinceMs === undefined) {
      return;
    }

    const elapsedMs = this.input.clock.nowMs() - notReadySinceMs;
    const remainingMs = this.notReadyReplacementDelayMs() - elapsedMs;
    if (remainingMs <= 0) {
      this.terminate("forwarding_not_ready_timeout");
      return;
    }
    if (this.notReadyReplacementTimer !== undefined) {
      return;
    }

    this.notReadyReplacementTimer = this.input.scheduler.schedule(() => {
      this.notReadyReplacementTimer = undefined;
      this.handleReadinessState(this.input.readiness.getState());
    }, remainingMs);
  }

  private terminate(reason: GatewayForwardingReplacementReason): void {
    this.terminated = true;
    this.cancelNotReadyReplacementTimer();
    logger.error(
      {
        eventName: "gateway.forwarding.recovery.terminate",
        "mistle.gateway.node_id": this.input.localNodeId,
        "mistle.gateway.forwarding.replacement_reason": reason,
      },
      "Gateway forwarding did not recover; terminating data-plane gateway.",
    );
    this.input.terminate(reason);
  }

  private maxConsecutiveCheckFailures(): number {
    return this.input.maxConsecutiveCheckFailures ?? DefaultMaxConsecutiveCheckFailures;
  }

  private notReadyReplacementDelayMs(): number {
    return this.input.notReadyReplacementDelayMs ?? DefaultNotReadyReplacementDelayMs;
  }

  private cancelNotReadyReplacementTimer(): void {
    if (this.notReadyReplacementTimer === undefined) {
      return;
    }

    this.input.scheduler.cancel(this.notReadyReplacementTimer);
    this.notReadyReplacementTimer = undefined;
  }
}
