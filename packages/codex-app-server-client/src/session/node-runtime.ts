import { randomUUID } from "node:crypto";

import WebSocket, { type RawData } from "ws";

import {
  type CodexScheduledTask,
  type CodexSessionRuntime,
  type CodexSessionSocket,
  type CodexSessionSocketEventMap,
  CodexSessionSocketReadyStates,
  type CodexSessionSocketEventName,
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

function toReadyState(value: number): CodexSessionSocket["readyState"] {
  switch (value) {
    case CodexSessionSocketReadyStates.CONNECTING:
    case CodexSessionSocketReadyStates.OPEN:
    case CodexSessionSocketReadyStates.CLOSING:
    case CodexSessionSocketReadyStates.CLOSED:
      return value;
    default:
      throw new Error(`Unsupported node websocket ready state '${String(value)}'.`);
  }
}

class NodeCodexSessionSocket implements CodexSessionSocket {
  readonly #socket: WebSocket;
  readonly #listenerMap = new Map<
    CodexSessionSocketEventMap[CodexSessionSocketEventName],
    (event: unknown) => void
  >();
  readonly #messageListenerMap = new Map<
    CodexSessionSocketEventMap["message"],
    (data: RawData) => void
  >();

  constructor(connectionUrl: string) {
    this.#socket = new WebSocket(connectionUrl);
  }

  get readyState(): CodexSessionSocket["readyState"] {
    return toReadyState(this.#socket.readyState);
  }

  addEventListener<EventName extends CodexSessionSocketEventName>(
    eventName: EventName,
    listener: CodexSessionSocketEventMap[EventName],
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

  removeEventListener<EventName extends CodexSessionSocketEventName>(
    eventName: EventName,
    listener: CodexSessionSocketEventMap[EventName],
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

class NodeCodexScheduledTask implements CodexScheduledTask {
  readonly #timeoutId: NodeJS.Timeout;

  constructor(timeoutId: NodeJS.Timeout) {
    this.#timeoutId = timeoutId;
  }

  cancel(): void {
    clearTimeout(this.#timeoutId);
  }
}

export function createNodeCodexSessionRuntime(): CodexSessionRuntime {
  return {
    createSocket: (connectionUrl) => new NodeCodexSessionSocket(connectionUrl),
    createRequestId: () => randomUUID(),
    scheduleTimeout: (callback, timeoutMs) =>
      new NodeCodexScheduledTask(setTimeout(callback, timeoutMs)),
  };
}
