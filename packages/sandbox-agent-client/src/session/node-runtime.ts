import { randomUUID } from "node:crypto";

import WebSocket, { type RawData } from "ws";

import {
  type SandboxAgentScheduledTask,
  type SandboxAgentRuntime,
  type SandboxAgentSocket,
  type SandboxAgentSocketEventMap,
  SandboxAgentSocketReadyStates,
  type SandboxAgentSocketEventName,
} from "./runtime.js";

function toMessageData(data: RawData): unknown {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

function toReadyState(value: number): SandboxAgentSocket["readyState"] {
  switch (value) {
    case SandboxAgentSocketReadyStates.CONNECTING:
    case SandboxAgentSocketReadyStates.OPEN:
    case SandboxAgentSocketReadyStates.CLOSING:
    case SandboxAgentSocketReadyStates.CLOSED:
      return value;
    default:
      throw new Error(`Unsupported node websocket ready state '${String(value)}'.`);
  }
}

class NodeSandboxAgentSocket implements SandboxAgentSocket {
  readonly #socket: WebSocket;
  readonly #listenerMap = new Map<
    SandboxAgentSocketEventMap[SandboxAgentSocketEventName],
    (event: unknown) => void
  >();
  readonly #messageListenerMap = new Map<
    SandboxAgentSocketEventMap["message"],
    (data: RawData) => void
  >();

  constructor(connectionUrl: string) {
    this.#socket = new WebSocket(connectionUrl);
  }

  get readyState(): SandboxAgentSocket["readyState"] {
    return toReadyState(this.#socket.readyState);
  }

  addEventListener<EventName extends SandboxAgentSocketEventName>(
    eventName: EventName,
    listener: SandboxAgentSocketEventMap[EventName],
  ): void {
    if (eventName === "message") {
      const wrappedMessageListener = (data: RawData): void => {
        listener(toMessageData(data));
      };

      this.#messageListenerMap.set(listener, wrappedMessageListener);
      this.#socket.on(eventName, wrappedMessageListener);
      return;
    }

    const wrappedListener = (event: unknown): void => {
      listener(event);
    };

    this.#listenerMap.set(listener, wrappedListener);
    this.#socket.on(eventName, wrappedListener);
  }

  removeEventListener<EventName extends SandboxAgentSocketEventName>(
    eventName: EventName,
    listener: SandboxAgentSocketEventMap[EventName],
  ): void {
    if (eventName === "message") {
      const wrappedMessageListener = this.#messageListenerMap.get(listener);
      if (wrappedMessageListener === undefined) {
        return;
      }

      this.#messageListenerMap.delete(listener);
      this.#socket.off(eventName, wrappedMessageListener);
      return;
    }

    const wrappedListener = this.#listenerMap.get(listener);
    if (wrappedListener === undefined) {
      return;
    }

    this.#listenerMap.delete(listener);
    this.#socket.off(eventName, wrappedListener);
  }

  send(payload: string): void {
    this.#socket.send(payload);
  }

  close(code?: number, reason?: string): void {
    this.#socket.close(code, reason);
  }
}

class NodeSandboxAgentScheduledTask implements SandboxAgentScheduledTask {
  readonly #timeoutId: NodeJS.Timeout;

  constructor(timeoutId: NodeJS.Timeout) {
    this.#timeoutId = timeoutId;
  }

  cancel(): void {
    clearTimeout(this.#timeoutId);
  }
}

export function createNodeSandboxAgentRuntime(): SandboxAgentRuntime {
  return {
    createSocket: (connectionUrl) => new NodeSandboxAgentSocket(connectionUrl),
    createRequestId: () => randomUUID(),
    scheduleTimeout: (callback, timeoutMs) =>
      new NodeSandboxAgentScheduledTask(setTimeout(callback, timeoutMs)),
  };
}
