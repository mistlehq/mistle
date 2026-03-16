import { systemScheduler } from "@mistle/time";
import WebSocket, { type RawData } from "ws";

import {
  type SandboxScheduledTask,
  SandboxSessionSendGuarantees,
  type SandboxSessionRuntime,
  type SandboxSessionSocket,
  type SandboxSessionSocketEventMap,
  SandboxSessionSocketReadyStates,
  type SandboxSessionSocketEventName,
} from "./runtime.js";

function toMessageData(data: RawData, isBinary: boolean): string | Uint8Array {
  if (!isBinary) {
    if (typeof data === "string") {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(new Uint8Array(data));
    }
    if (Buffer.isBuffer(data)) {
      return data.toString("utf8");
    }

    return Buffer.concat(data).toString("utf8");
  }

  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }

  return new Uint8Array(Buffer.concat(data));
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
    (data: RawData, isBinary: boolean) => void
  >();

  constructor(connectionUrl: string) {
    this.#socket = new WebSocket(connectionUrl);
  }

  get readyState(): SandboxSessionSocket["readyState"] {
    return toReadyState(this.#socket.readyState);
  }

  get sendGuarantee(): SandboxSessionSocket["sendGuarantee"] {
    return SandboxSessionSendGuarantees.WRITTEN;
  }

  addEventListener<EventName extends SandboxSessionSocketEventName>(
    eventName: EventName,
    listener: SandboxSessionSocketEventMap[EventName],
  ): void {
    if (eventName === "message") {
      const wrappedMessageListener = (data: RawData, isBinary: boolean): void => {
        listener(toMessageData(data, isBinary));
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

  send(payload: ArrayBuffer | Uint8Array | string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.#socket.send(payload, (error) => {
        if (error == null) {
          resolve();
          return;
        }

        reject(error);
      });
    });
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
