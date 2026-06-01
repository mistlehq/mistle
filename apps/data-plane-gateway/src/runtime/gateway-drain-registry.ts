import type { Duplex } from "node:stream";

import { systemScheduler, type Scheduler, type TimerHandle } from "@mistle/time";
import WebSocket from "ws";

import {
  GatewayWebSocketCloseCodes,
  GatewayWebSocketCloseReasons,
} from "./gateway-websocket-close.js";

export type GatewayDrainWebSocketCategory = "direct_egress" | "pty_transport" | "sandbox_tunnel";
export type GatewayRawLongLivedConnectionCategory = "port_access";

export type GatewayDrainWebSocket = Pick<WebSocket, "close" | "readyState" | "terminate">;

export type GatewayDrainRegistryCounts = {
  rawLongLivedConnectionCount: number;
  webSocketCount: number;
};

export type GatewayDrainRegistryCategoryCounts = {
  directEgressWebSocketCount: number;
  portAccessRawConnectionCount: number;
  ptyTransportWebSocketCount: number;
  sandboxTunnelWebSocketCount: number;
};

export type GatewayDrainRegistryCloseResult = GatewayDrainRegistryCounts &
  GatewayDrainRegistryCategoryCounts & {
    forcedRawLongLivedConnectionCount: number;
    forcedWebSocketCount: number;
    graceful: boolean;
    rawLongLivedConnectionEndCount: number;
    serviceRestartWebSocketCloseCount: number;
  };

type RegisteredWebSocket = {
  category: GatewayDrainWebSocketCategory;
  socket: GatewayDrainWebSocket;
};

type RegisteredRawLongLivedConnection = {
  category: GatewayRawLongLivedConnectionCategory;
  removeCloseListener: () => void;
  socket: Duplex;
};

type ServiceRestartDrainState = {
  rawLongLivedConnectionEndCount: number;
  serviceRestartWebSocketCloseCount: number;
};

export class GatewayDrainRegistry {
  readonly #rawConnections = new Map<number, RegisteredRawLongLivedConnection>();
  readonly #waiters = new Set<() => void>();
  readonly #webSockets = new Map<number, RegisteredWebSocket>();

  #nextRegistrationId = 1;
  #serviceRestartDrainState: ServiceRestartDrainState | null = null;

  public constructor(private readonly scheduler: Scheduler = systemScheduler) {}

  public activeCounts(): GatewayDrainRegistryCounts {
    return {
      rawLongLivedConnectionCount: this.#rawConnections.size,
      webSocketCount: this.#webSockets.size,
    };
  }

  public activeCategoryCounts(): GatewayDrainRegistryCategoryCounts {
    const counts: GatewayDrainRegistryCategoryCounts = {
      directEgressWebSocketCount: 0,
      portAccessRawConnectionCount: 0,
      ptyTransportWebSocketCount: 0,
      sandboxTunnelWebSocketCount: 0,
    };

    for (const registration of this.#webSockets.values()) {
      if (registration.category === "direct_egress") {
        counts.directEgressWebSocketCount += 1;
      } else if (registration.category === "pty_transport") {
        counts.ptyTransportWebSocketCount += 1;
      } else {
        counts.sandboxTunnelWebSocketCount += 1;
      }
    }

    for (const registration of this.#rawConnections.values()) {
      if (registration.category === "port_access") {
        counts.portAccessRawConnectionCount += 1;
      }
    }

    return counts;
  }

  public registerGatewayWebSocket(input: {
    category: GatewayDrainWebSocketCategory;
    socket: GatewayDrainWebSocket;
  }): () => void {
    const registrationId = this.#nextRegistrationId;
    this.#nextRegistrationId += 1;
    this.#webSockets.set(registrationId, {
      category: input.category,
      socket: input.socket,
    });
    this.#closeWebSocketForActiveServiceRestartDrain(input.socket);

    return () => {
      this.#webSockets.delete(registrationId);
      this.#notifyIfEmpty();
    };
  }

  public registerRawLongLivedConnection(input: {
    category: GatewayRawLongLivedConnectionCategory;
    socket: Duplex;
  }): () => void {
    const registrationId = this.#nextRegistrationId;
    this.#nextRegistrationId += 1;
    const removeCloseListener = (): void => {
      input.socket.off("close", unregister);
    };
    const unregister = (): void => {
      removeCloseListener();
      this.#rawConnections.delete(registrationId);
      this.#notifyIfEmpty();
    };
    input.socket.once("close", unregister);
    this.#rawConnections.set(registrationId, {
      category: input.category,
      removeCloseListener,
      socket: input.socket,
    });
    this.#endRawConnectionForActiveServiceRestartDrain(input.socket);

    return unregister;
  }

  public async closeForServiceRestart(input: {
    waitMs: number;
  }): Promise<GatewayDrainRegistryCloseResult> {
    const initialCounts = this.activeCounts();
    const initialCategoryCounts = this.activeCategoryCounts();
    const drainState = this.#startServiceRestartDrain();

    for (const registration of this.#webSockets.values()) {
      this.#closeWebSocketForActiveServiceRestartDrain(registration.socket);
    }

    for (const registration of this.#rawConnections.values()) {
      this.#endRawConnectionForActiveServiceRestartDrain(registration.socket);
    }

    const graceful = await this.#waitForEmpty(input.waitMs);
    let forcedWebSocketCount = 0;
    let forcedRawLongLivedConnectionCount = 0;
    if (!graceful) {
      for (const registration of this.#webSockets.values()) {
        if (registration.socket.readyState === WebSocket.CLOSED) {
          continue;
        }

        registration.socket.terminate();
        forcedWebSocketCount += 1;
      }

      for (const registration of this.#rawConnections.values()) {
        if (registration.socket.destroyed) {
          continue;
        }

        registration.socket.destroy();
        forcedRawLongLivedConnectionCount += 1;
      }
    }

    return {
      ...initialCounts,
      ...initialCategoryCounts,
      forcedRawLongLivedConnectionCount,
      forcedWebSocketCount,
      graceful,
      rawLongLivedConnectionEndCount: drainState.rawLongLivedConnectionEndCount,
      serviceRestartWebSocketCloseCount: drainState.serviceRestartWebSocketCloseCount,
    };
  }

  public finishServiceRestartDrain(): void {
    this.#serviceRestartDrainState = null;
  }

  #startServiceRestartDrain(): ServiceRestartDrainState {
    if (this.#serviceRestartDrainState !== null) {
      return this.#serviceRestartDrainState;
    }

    this.#serviceRestartDrainState = {
      rawLongLivedConnectionEndCount: 0,
      serviceRestartWebSocketCloseCount: 0,
    };
    return this.#serviceRestartDrainState;
  }

  #closeWebSocketForActiveServiceRestartDrain(socket: GatewayDrainWebSocket): void {
    if (this.#serviceRestartDrainState === null) {
      return;
    }

    if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      return;
    }

    socket.close(
      GatewayWebSocketCloseCodes.SERVICE_RESTART,
      GatewayWebSocketCloseReasons.SERVICE_RESTART,
    );
    this.#serviceRestartDrainState.serviceRestartWebSocketCloseCount += 1;
  }

  #endRawConnectionForActiveServiceRestartDrain(socket: Duplex): void {
    if (this.#serviceRestartDrainState === null) {
      return;
    }

    if (socket.destroyed) {
      return;
    }

    socket.end();
    this.#serviceRestartDrainState.rawLongLivedConnectionEndCount += 1;
  }

  #isEmpty(): boolean {
    return this.#webSockets.size === 0 && this.#rawConnections.size === 0;
  }

  #notifyIfEmpty(): void {
    if (!this.#isEmpty()) {
      return;
    }

    for (const waiter of this.#waiters) {
      waiter();
    }
  }

  async #waitForEmpty(waitMs: number): Promise<boolean> {
    if (this.#isEmpty()) {
      return true;
    }

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const timeout: TimerHandle = this.scheduler.schedule(() => {
        finish(false);
      }, waitMs);
      const waiter = (): void => {
        finish(true);
      };
      const finish = (result: boolean): void => {
        if (settled) {
          return;
        }

        settled = true;
        this.scheduler.cancel(timeout);
        this.#waiters.delete(waiter);
        resolve(result);
      };

      this.#waiters.add(waiter);
    });
  }
}
