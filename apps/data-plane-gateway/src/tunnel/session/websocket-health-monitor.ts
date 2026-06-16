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
  pingScheduleDelayMs: number;
  pingSentAtMs: number;
  pingSeq: number;
  pingWriteCallbackAtMs: number | null;
  pingWriteDurationMs: number | null;
  pongTimeoutDriftMs: number;
  pongTimeoutFiredAtMs: number;
  socket: WebSocketHealthSocketSnapshot;
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
  lastControlFrame: WebSocketHealthControlFrameKind | null;
  lastControlFrameAtMs: number | null;
  lastPeerPingAtMs: number | null;
  lastPongAtMs: number | null;
  lastPongPingSeq: number | null;
  pingInFlight: boolean;
  pingSeq: number | null;
};

export type WebSocketHealthControlFrameKind = "close" | "error" | "ping" | "pong";

export type WebSocketHealthPeerPingReceived = {
  payloadLen: number;
  receivedAtMs: number;
  socket: WebSocketHealthSocketSnapshot;
};

export type WebSocketHealthPongReceived = {
  expectedPingSeq: number | null;
  lastPongAgeMs: number;
  matched: boolean;
  pingSeq: number | null;
  receivedAtMs: number;
  sentAtMs: number | null;
  socket: WebSocketHealthSocketSnapshot;
};

export type WebSocketHealthSocketClosed = {
  closeCode: number;
  closeReason: string;
  observedAtMs: number;
  socket: WebSocketHealthSocketSnapshot;
};

export type WebSocketHealthSocketError = {
  error: Error;
  observedAtMs: number;
  socket: WebSocketHealthSocketSnapshot;
};

export type WebSocketHealthPingWriteCompleted = {
  pingScheduleDelayMs: number;
  pingSentAtMs: number;
  pingSeq: number;
  pingWriteCallbackAtMs: number;
  pingWriteDurationMs: number;
  socket: WebSocketHealthSocketSnapshot;
};

export type WebSocketHealthPingWriteFailed = WebSocketHealthPingWriteCompleted & {
  error: Error;
};

export type WebSocketHealthSocketSnapshot = {
  bufferedAmount: number;
  readyState: 0 | 1 | 2 | 3;
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
  onPeerPingReceived?: (state: WebSocketHealthPeerPingReceived) => void;
  onPingWriteCompleted?: (state: WebSocketHealthPingWriteCompleted) => void;
  onPingWriteFailed?: (state: WebSocketHealthPingWriteFailed) => void;
  onPongReceived?: (state: WebSocketHealthPongReceived) => void;
  onRecovered?: (state: WebSocketHealthRecovered) => void;
  onSocketClosed?: (state: WebSocketHealthSocketClosed) => void;
  onSocketError?: (state: WebSocketHealthSocketError) => void;
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
  let lastPongReceivedAtMs: number | undefined;
  let lastControlFrame: WebSocketHealthControlFrameKind | undefined;
  let lastControlFrameAtMs: number | undefined;
  let lastPeerPingAtMs: number | undefined;
  let lastPongPingSeq: number | undefined;
  let nextPingSeq = 1;
  let pingSeq: number | undefined;
  let pingScheduleDelayMs: number | undefined;
  let pingWriteCallbackAtMs: number | undefined;
  let pingWriteDurationMs: number | undefined;
  const maxConsecutiveMissedPongs = input.maxConsecutiveMissedPongs ?? 1;

  if (maxConsecutiveMissedPongs < 1) {
    throw new Error("Expected websocket health monitor missed pong threshold to be positive.");
  }

  const onPong = (data: RawData): void => {
    if (stopped) {
      return;
    }
    const pongPayload = parseHealthPingPayload(data);
    const nowMs = input.clock.nowMs();
    lastControlFrame = "pong";
    lastControlFrameAtMs = nowMs;
    const matched =
      pongPayload === null || pingSeq === undefined || pongPayload.pingSeq === pingSeq;
    input.onPongReceived?.({
      expectedPingSeq: pingSeq ?? null,
      lastPongAgeMs: nowMs - lastPongAtMs,
      matched,
      pingSeq: pongPayload?.pingSeq ?? null,
      receivedAtMs: nowMs,
      sentAtMs: pongPayload?.sentAtMs ?? null,
      socket: snapshotWebSocketHealthSocket(input.socket),
    });
    if (!matched) {
      return;
    }
    if (pingSentAtMs !== undefined) {
      const roundTripTimeMs = nowMs - pingSentAtMs;
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
    if (consecutiveMissedPongs > 0) {
      input.onRecovered?.({
        consecutiveMissedPongs,
        lastPongAgeMs: nowMs - lastPongAtMs,
        pingSeq: pongPayload?.pingSeq ?? pingSeq ?? null,
      });
    }
    consecutiveMissedPongs = 0;
    lastPongAtMs = nowMs;
    lastPongReceivedAtMs = nowMs;
    lastPongPingSeq = pongPayload?.pingSeq ?? pingSeq;
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
    rawSocket.off("close", onClose);
    rawSocket.off("error", onError);
    rawSocket.off("ping", onPing);
    rawSocket.off("pong", onPong);
  };

  const onPing = (data: RawData): void => {
    if (stopped) {
      return;
    }
    const nowMs = input.clock.nowMs();
    lastControlFrame = "ping";
    lastControlFrameAtMs = nowMs;
    lastPeerPingAtMs = nowMs;
    input.onPeerPingReceived?.({
      payloadLen: rawDataToBuffer(data).length,
      receivedAtMs: nowMs,
      socket: snapshotWebSocketHealthSocket(input.socket),
    });
  };

  const onClose = (code: number, reason: Buffer): void => {
    const nowMs = input.clock.nowMs();
    lastControlFrame = "close";
    lastControlFrameAtMs = nowMs;
    input.onSocketClosed?.({
      closeCode: code,
      closeReason: reason.toString("utf8"),
      observedAtMs: nowMs,
      socket: snapshotWebSocketHealthSocket(input.socket),
    });
    stopForClosedSocket();
  };

  const onError = (error: Error): void => {
    if (stopped) {
      return;
    }
    const nowMs = input.clock.nowMs();
    lastControlFrame = "error";
    lastControlFrameAtMs = nowMs;
    input.onSocketError?.({
      error,
      observedAtMs: nowMs,
      socket: snapshotWebSocketHealthSocket(input.socket),
    });
  };

  const scheduleNextPing = (): void => {
    if (stopped || !healthy) {
      return;
    }
    if (pingHandle !== undefined) {
      return;
    }

    const scheduledPingAtMs = input.clock.nowMs() + input.pingIntervalMs;
    pingHandle = input.scheduler.schedule(() => {
      pingHandle = undefined;

      if (stopped || !healthy) {
        return;
      }
      if (input.socket.readyState !== WebSocket.OPEN) {
        stopForClosedSocket();
        return;
      }

      const timeoutScheduledAtMs = input.clock.nowMs() + input.pongTimeoutMs;
      pongTimeoutHandle = input.scheduler.schedule(() => {
        pongTimeoutHandle = undefined;
        if (input.socket.readyState !== WebSocket.OPEN) {
          stopForClosedSocket();
          return;
        }
        const nowMs = input.clock.nowMs();
        const timedOutPingSentAtMs = pingSentAtMs ?? input.clock.nowMs();
        const timedOutPingSeq = pingSeq ?? 0;
        const timedOutPingScheduleDelayMs = pingScheduleDelayMs ?? 0;
        const timedOutPingWriteCallbackAtMs = pingWriteCallbackAtMs ?? null;
        const timedOutPingWriteDurationMs = pingWriteDurationMs ?? null;
        pingSentAtMs = undefined;
        pingSeq = undefined;
        pingScheduleDelayMs = undefined;
        pingWriteCallbackAtMs = undefined;
        pingWriteDurationMs = undefined;
        consecutiveMissedPongs += 1;
        input.onMissedPong?.({
          consecutiveMissedPongs,
          lastPongAgeMs: nowMs - lastPongAtMs,
          maxConsecutiveMissedPongs,
          pingScheduleDelayMs: timedOutPingScheduleDelayMs,
          pingSentAtMs: timedOutPingSentAtMs,
          pingSeq: timedOutPingSeq,
          pingWriteCallbackAtMs: timedOutPingWriteCallbackAtMs,
          pingWriteDurationMs: timedOutPingWriteDurationMs,
          pongTimeoutDriftMs: nowMs - timeoutScheduledAtMs,
          pongTimeoutFiredAtMs: nowMs,
          socket: snapshotWebSocketHealthSocket(input.socket),
        });
        if (consecutiveMissedPongs >= maxConsecutiveMissedPongs) {
          markUnhealthy();
          return;
        }
        scheduleNextPing();
      }, input.pongTimeoutMs);

      pingSentAtMs = input.clock.nowMs();
      pingSeq = nextPingSeq;
      pingScheduleDelayMs = pingSentAtMs - scheduledPingAtMs;
      pingWriteCallbackAtMs = undefined;
      pingWriteDurationMs = undefined;
      nextPingSeq += 1;
      const currentPingSeq = pingSeq;
      const currentPingSentAtMs = pingSentAtMs;
      const currentPingScheduleDelayMs = pingScheduleDelayMs;
      rawSocket.ping(
        createHealthPingPayload({
          pingSeq: currentPingSeq,
          sentAtMs: currentPingSentAtMs,
        }),
        false,
        (error: Error | null | undefined) => {
          const callbackAtMs = input.clock.nowMs();
          const writeDurationMs = callbackAtMs - currentPingSentAtMs;
          if (pingSeq === currentPingSeq) {
            pingWriteCallbackAtMs = callbackAtMs;
            pingWriteDurationMs = writeDurationMs;
          }
          if (error != null) {
            input.onPingWriteFailed?.({
              error,
              pingScheduleDelayMs: currentPingScheduleDelayMs,
              pingSentAtMs: currentPingSentAtMs,
              pingSeq: currentPingSeq,
              pingWriteCallbackAtMs: callbackAtMs,
              pingWriteDurationMs: writeDurationMs,
              socket: snapshotWebSocketHealthSocket(input.socket),
            });
            if (input.socket.readyState !== WebSocket.OPEN) {
              stopForClosedSocket();
              return;
            }
            markUnhealthy();
            return;
          }
          input.onPingWriteCompleted?.({
            pingScheduleDelayMs: currentPingScheduleDelayMs,
            pingSentAtMs: currentPingSentAtMs,
            pingSeq: currentPingSeq,
            pingWriteCallbackAtMs: callbackAtMs,
            pingWriteDurationMs: writeDurationMs,
            socket: snapshotWebSocketHealthSocket(input.socket),
          });
        },
      );
    }, input.pingIntervalMs);
  };

  rawSocket.on("close", onClose);
  rawSocket.on("error", onError);
  rawSocket.on("ping", onPing);
  rawSocket.on("pong", onPong);
  scheduleNextPing();

  return {
    stop: () => {
      if (stopped) {
        return;
      }

      stopped = true;
      cleanupTimers();
      rawSocket.off("close", onClose);
      rawSocket.off("error", onError);
      rawSocket.off("ping", onPing);
      rawSocket.off("pong", onPong);
    },
    isHealthy: () => healthy,
    getSnapshot: () => ({
      healthy,
      consecutiveMissedPongs,
      lastPongAgeMs: input.clock.nowMs() - lastPongAtMs,
      lastControlFrame: lastControlFrame ?? null,
      lastControlFrameAtMs: lastControlFrameAtMs ?? null,
      lastPeerPingAtMs: lastPeerPingAtMs ?? null,
      lastPongAtMs: lastPongReceivedAtMs ?? null,
      lastPongPingSeq: lastPongPingSeq ?? null,
      pingInFlight: pingSentAtMs !== undefined,
      pingSeq: pingSeq ?? null,
    }),
  };
}

function snapshotWebSocketHealthSocket(socket: RelayPeerSocket): WebSocketHealthSocketSnapshot {
  const rawSocket = socket.raw;

  return {
    bufferedAmount: rawSocket?.bufferedAmount ?? 0,
    readyState: toWebSocketReadyState(socket.readyState),
  };
}

function toWebSocketReadyState(input: number): 0 | 1 | 2 | 3 {
  if (input === 0 || input === 1 || input === 2 || input === 3) {
    return input;
  }
  return WebSocket.CLOSED;
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
