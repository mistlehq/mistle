import { systemScheduler } from "@mistle/time";
import WebSocket, { type RawData } from "ws";

import {
  type SandboxScheduledTask,
  type SandboxSessionRuntime,
  type SandboxSessionSocket,
  type SandboxSessionSocketEventMap,
  SandboxSessionSocketReadyStates,
  type SandboxSessionSocketEventName,
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

function toReadyState(value: number): SandboxSessionSocket["readyState"] {
  switch (value) {
    case SandboxSessionSocketReadyStates.CONNECTING:
    case SandboxSessionSocketReadyStates.OPEN:
    case SandboxSessionSocketReadyStates.CLOSING:
    case SandboxSessionSocketReadyStates.CLOSED:
      return value;
    default:
      throw new Error(`Unsupported node websocket ready state '${String(value)}'.`);
  }
}

class NodeSandboxSessionSocket implements SandboxSessionSocket {
  readonly #socket: WebSocket;
  readonly #listenerMap = new Map<
    SandboxSessionSocketEventMap[SandboxSessionSocketEventName],
    (event: unknown) => void
  >();
  readonly #messageListenerMap = new Map<
    SandboxSessionSocketEventMap["message"],
    (data: RawData) => void
  >();

  constructor(connectionUrl: string) {
    this.#socket = new WebSocket(connectionUrl);
  }

  get readyState(): SandboxSessionSocket["readyState"] {
    return toReadyState(this.#socket.readyState);
  }

  addEventListener<EventName extends SandboxSessionSocketEventName>(
    eventName: EventName,
    listener: SandboxSessionSocketEventMap[EventName],
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

  removeEventListener<EventName extends SandboxSessionSocketEventName>(
    eventName: EventName,
    listener: SandboxSessionSocketEventMap[EventName],
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

class NodeSandboxScheduledTask implements SandboxScheduledTask {
  readonly #timeoutTask: ReturnType<typeof systemScheduler.schedule>;

  constructor(timeoutTask: ReturnType<typeof systemScheduler.schedule>) {
    this.#timeoutTask = timeoutTask;
  }

  cancel(): void {
    systemScheduler.cancel(this.#timeoutTask);
  }
}

function createSequentialStreamId(): () => number {
  let nextStreamId = 1;

  return () => {
    const streamId = nextStreamId;
    nextStreamId += 1;
    return streamId;
  };
}

export function createNodeSandboxSessionRuntime(): SandboxSessionRuntime {
  const createStreamId = createSequentialStreamId();

  return {
    createSocket: (connectionUrl) => new NodeSandboxSessionSocket(connectionUrl),
    createStreamId,
    scheduleTimeout: (callback, timeoutMs) =>
      new NodeSandboxScheduledTask(systemScheduler.schedule(callback, timeoutMs)),
  };
}
