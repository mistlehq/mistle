import type { Clock } from "@mistle/time";

import type { GatewayWebSocketCloseReason } from "./gateway-websocket-close.js";

export type GatewayDrainReason = GatewayWebSocketCloseReason;

export type GatewayLifecycleState =
  | { status: "serving" }
  | { reason: GatewayDrainReason; startedAtMs: number; status: "draining" };

export class GatewayLifecycle {
  private state: GatewayLifecycleState = { status: "serving" };

  public constructor(private readonly clock: Clock) {}

  public getState(): GatewayLifecycleState {
    return this.state;
  }

  public isServing(): boolean {
    return this.state.status === "serving";
  }

  public startDrain(input: { reason: GatewayDrainReason }): GatewayLifecycleState {
    if (this.state.status === "draining") {
      return this.state;
    }

    this.state = {
      status: "draining",
      reason: input.reason,
      startedAtMs: this.clock.nowMs(),
    };

    return this.state;
  }
}
