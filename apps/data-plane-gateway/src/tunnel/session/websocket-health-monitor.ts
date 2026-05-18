import type { Clock, Scheduler, TimerHandle } from "@mistle/time";
import { metrics, type Attributes } from "@opentelemetry/api";
import { WebSocket } from "ws";

import { getSandboxTunnelDeliveryCorrelationScope } from "../telemetry.js";
import type { RelayPeerSide, RelayPeerSocket } from "../types.js";

type TunnelTokenKind = "bootstrap" | "connection";

const TunnelTelemetryMeter = metrics.getMeter("@mistle/data-plane-gateway/tunnel");
const TunnelWebSocketRoundTripTimeMs = TunnelTelemetryMeter.createHistogram(
  "mistle.sandbox.tunnel.websocket.rtt",
  {
    description: "Observed websocket ping/pong round-trip time for tunnel websocket peers.",
    unit: "ms",
  },
);

export type WebSocketHealthHandle = {
  stop: () => void;
  isHealthy: () => boolean;
};

export type WebSocketHealthMissedPong = {
  consecutiveMissedPongs: number;
  lastPongAgeMs: number;
  maxConsecutiveMissedPongs: number;
};

/**
 * Starts active ping/pong health checks for a tunnel websocket.
 *
 * The gateway sends pings, expects timely pong responses, and calls
 * `onUnhealthy` when the socket stops responding while still nominally open.
 */
export function startWebSocketHealthMonitor(input: {
  clock: Clock;
  socketKind: RelayPeerSide;
  tokenKind: TunnelTokenKind;
  socket: RelayPeerSocket;
  scheduler: Scheduler;
  pingIntervalMs: number;
  pongTimeoutMs: number;
  maxConsecutiveMissedPongs?: number;
  onMissedPong?: (state: WebSocketHealthMissedPong) => void;
  onUnhealthy: () => void;
  onRoundTripTimeObserved?: (roundTripTimeMs: number) => void;
}): WebSocketHealthHandle {
  const rawSocket = input.socket.raw;
  if (rawSocket === undefined) {
    throw new Error("Expected websocket raw socket for health monitoring.");
  }

  let healthy = true;
  let stopped = false;
  let pingHandle: TimerHandle | undefined;
  let pingSentAtMs: number | undefined;
  let pongTimeoutHandle: TimerHandle | undefined;
  let consecutiveMissedPongs = 0;
  let lastPongAtMs = input.clock.nowMs();
  const maxConsecutiveMissedPongs = input.maxConsecutiveMissedPongs ?? 1;

  if (maxConsecutiveMissedPongs < 1) {
    throw new Error("Expected websocket health monitor missed pong threshold to be positive.");
  }

  const onPong = (): void => {
    if (stopped) {
      return;
    }
    if (pingSentAtMs !== undefined) {
      const roundTripTimeMs = input.clock.nowMs() - pingSentAtMs;
      TunnelWebSocketRoundTripTimeMs.record(
        roundTripTimeMs,
        buildRoundTripAttributes({
          socketKind: input.socketKind,
          tokenKind: input.tokenKind,
        }),
      );
      input.onRoundTripTimeObserved?.(roundTripTimeMs);
      pingSentAtMs = undefined;
    }
    consecutiveMissedPongs = 0;
    lastPongAtMs = input.clock.nowMs();
    if (pongTimeoutHandle !== undefined) {
      input.scheduler.cancel(pongTimeoutHandle);
      pongTimeoutHandle = undefined;
    }
    scheduleNextPing();
  };

  const cleanupTimers = (): void => {
    if (pingHandle !== undefined) {
      input.scheduler.cancel(pingHandle);
      pingHandle = undefined;
    }
    if (pongTimeoutHandle !== undefined) {
      input.scheduler.cancel(pongTimeoutHandle);
      pongTimeoutHandle = undefined;
    }
  };

  const markUnhealthy = (): void => {
    if (stopped || !healthy) {
      return;
    }

    healthy = false;
    cleanupTimers();
    input.onUnhealthy();
  };

  const scheduleNextPing = (): void => {
    if (stopped || !healthy) {
      return;
    }
    if (pingHandle !== undefined) {
      return;
    }

    pingHandle = input.scheduler.schedule(() => {
      pingHandle = undefined;

      if (stopped || !healthy) {
        return;
      }
      if (input.socket.readyState !== WebSocket.OPEN) {
        markUnhealthy();
        return;
      }

      pongTimeoutHandle = input.scheduler.schedule(() => {
        pongTimeoutHandle = undefined;
        pingSentAtMs = undefined;
        consecutiveMissedPongs += 1;
        input.onMissedPong?.({
          consecutiveMissedPongs,
          lastPongAgeMs: input.clock.nowMs() - lastPongAtMs,
          maxConsecutiveMissedPongs,
        });
        if (consecutiveMissedPongs >= maxConsecutiveMissedPongs) {
          markUnhealthy();
          return;
        }
        scheduleNextPing();
      }, input.pongTimeoutMs);

      pingSentAtMs = input.clock.nowMs();
      rawSocket.ping(undefined, false, (error: Error | null | undefined) => {
        if (error != null) {
          markUnhealthy();
        }
      });
    }, input.pingIntervalMs);
  };

  rawSocket.on("pong", onPong);
  scheduleNextPing();

  return {
    stop: () => {
      if (stopped) {
        return;
      }

      stopped = true;
      cleanupTimers();
      rawSocket.off("pong", onPong);
    },
    isHealthy: () => healthy,
  };
}

function buildRoundTripAttributes(input: {
  socketKind: RelayPeerSide;
  tokenKind: TunnelTokenKind;
}): Attributes {
  const deliveryCorrelationScope = getSandboxTunnelDeliveryCorrelationScope({
    tokenKind: input.tokenKind,
  });
  return {
    "mistle.socket_kind": input.socketKind,
    "mistle.delivery.correlation_scope": deliveryCorrelationScope,
  };
}
