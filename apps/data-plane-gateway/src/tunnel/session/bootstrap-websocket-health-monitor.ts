import type { Scheduler, TimerHandle } from "@mistle/time";

import type { RelayPeerSocket } from "../types.js";

const WebSocketOpenReadyState = 1;

export type BootstrapWebSocketHealthHandle = {
  stop: () => void;
  isHealthy: () => boolean;
};

/**
 * Starts active ping/pong health checks for a bootstrap websocket.
 *
 * The gateway sends pings, expects timely pong responses, and calls
 * `onUnhealthy` when the socket stops responding while still nominally open.
 */
export function startBootstrapWebSocketHealthMonitor(input: {
  socket: RelayPeerSocket;
  scheduler: Scheduler;
  pingIntervalMs: number;
  pongTimeoutMs: number;
  onUnhealthy: () => void;
}): BootstrapWebSocketHealthHandle {
  const rawSocket = input.socket.raw;
  if (rawSocket === undefined) {
    throw new Error("Expected bootstrap websocket raw socket for health monitoring.");
  }

  let healthy = true;
  let stopped = false;
  let pingHandle: TimerHandle | undefined;
  let pongTimeoutHandle: TimerHandle | undefined;

  const onPong = (): void => {
    if (stopped) {
      return;
    }
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

    pingHandle = input.scheduler.schedule(() => {
      pingHandle = undefined;

      if (stopped || !healthy) {
        return;
      }
      if (input.socket.readyState !== WebSocketOpenReadyState) {
        markUnhealthy();
        return;
      }

      pongTimeoutHandle = input.scheduler.schedule(() => {
        pongTimeoutHandle = undefined;
        markUnhealthy();
      }, input.pongTimeoutMs);

      rawSocket.ping(undefined, false, (error?: Error) => {
        if (error !== undefined) {
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
