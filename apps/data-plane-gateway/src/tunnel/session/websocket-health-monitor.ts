import type { Clock, Scheduler, TimerHandle } from "@mistle/time";
import { metrics, type Attributes } from "@opentelemetry/api";
import { WebSocket, type RawData } from "ws";

import { getSandboxTunnelDeliveryCorrelationScope } from "../telemetry.js";
import type { RelayPeerSide, RelayPeerSocket } from "../types.js";

type TunnelTokenKind = "bootstrap" | "connection" | "pty";

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
  getSnapshot: () => WebSocketHealthSnapshot;
};

export type WebSocketHealthMissedPong = {
  consecutiveMissedPongs: number;
  lastPongAgeMs: number;
  maxConsecutiveMissedPongs: number;
  pingSentAtMs: number;
  pingSeq: number;
};

export type WebSocketHealthRecovered = {
  consecutiveMissedPongs: number;
  lastPongAgeMs: number;
  pingSeq: number | null;
};

export type WebSocketHealthSnapshot = {
  healthy: boolean;
  consecutiveMissedPongs: number;
  lastPongAgeMs: number;
  pingInFlight: boolean;
  pingSeq: number | null;
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
  onRecovered?: (state: WebSocketHealthRecovered) => void;
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
  let nextPingSeq = 1;
  let pingSeq: number | undefined;
  const maxConsecutiveMissedPongs = input.maxConsecutiveMissedPongs ?? 1;

  if (maxConsecutiveMissedPongs < 1) {
    throw new Error("Expected websocket health monitor missed pong threshold to be positive.");
  }

  const onPong = (data: RawData): void => {
    if (stopped) {
      return;
    }
    const pongPayload = parseHealthPingPayload(data);
    if (pongPayload !== null && pingSeq !== undefined && pongPayload.pingSeq !== pingSeq) {
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
    const nowMs = input.clock.nowMs();
    if (consecutiveMissedPongs > 0) {
      input.onRecovered?.({
        consecutiveMissedPongs,
        lastPongAgeMs: nowMs - lastPongAtMs,
        pingSeq: pongPayload?.pingSeq ?? pingSeq ?? null,
      });
    }
    consecutiveMissedPongs = 0;
    lastPongAtMs = nowMs;
    pingSeq = undefined;
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

  const stopForClosedSocket = (): void => {
    if (stopped) {
      return;
    }

    stopped = true;
    cleanupTimers();
    rawSocket.off("pong", onPong);
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
        stopForClosedSocket();
        return;
      }

      pongTimeoutHandle = input.scheduler.schedule(() => {
        pongTimeoutHandle = undefined;
        if (input.socket.readyState !== WebSocket.OPEN) {
          stopForClosedSocket();
          return;
        }
        const timedOutPingSentAtMs = pingSentAtMs ?? input.clock.nowMs();
        const timedOutPingSeq = pingSeq ?? 0;
        pingSentAtMs = undefined;
        pingSeq = undefined;
        consecutiveMissedPongs += 1;
        input.onMissedPong?.({
          consecutiveMissedPongs,
          lastPongAgeMs: input.clock.nowMs() - lastPongAtMs,
          maxConsecutiveMissedPongs,
          pingSentAtMs: timedOutPingSentAtMs,
          pingSeq: timedOutPingSeq,
        });
        if (consecutiveMissedPongs >= maxConsecutiveMissedPongs) {
          markUnhealthy();
          return;
        }
        scheduleNextPing();
      }, input.pongTimeoutMs);

      pingSentAtMs = input.clock.nowMs();
      pingSeq = nextPingSeq;
      nextPingSeq += 1;
      rawSocket.ping(
        createHealthPingPayload({
          pingSeq,
          sentAtMs: pingSentAtMs,
        }),
        false,
        (error: Error | null | undefined) => {
          if (error != null) {
            if (input.socket.readyState !== WebSocket.OPEN) {
              stopForClosedSocket();
              return;
            }
            markUnhealthy();
          }
        },
      );
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
    getSnapshot: () => ({
      healthy,
      consecutiveMissedPongs,
      lastPongAgeMs: input.clock.nowMs() - lastPongAtMs,
      pingInFlight: pingSentAtMs !== undefined,
      pingSeq: pingSeq ?? null,
    }),
  };
}

function createHealthPingPayload(input: { pingSeq: number; sentAtMs: number }): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: "mistle.tunnel.health_ping",
      pingSeq: input.pingSeq,
      sentAtMs: input.sentAtMs,
    }),
  );
}

function parseHealthPingPayload(data: RawData): { pingSeq: number; sentAtMs: number } | null {
  const buffer = rawDataToBuffer(data);
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const type = Reflect.get(parsed, "type");
  const pingSeq = Reflect.get(parsed, "pingSeq");
  const sentAtMs = Reflect.get(parsed, "sentAtMs");
  if (
    type !== "mistle.tunnel.health_ping" ||
    typeof pingSeq !== "number" ||
    typeof sentAtMs !== "number"
  ) {
    return null;
  }
  return {
    pingSeq,
    sentAtMs,
  };
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  return Buffer.concat(data);
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
