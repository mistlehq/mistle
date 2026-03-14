import {
  type SandboxScheduledTask,
  type SandboxSessionRuntime,
  type SandboxSessionSocket,
  type SandboxSessionSocketEventMap,
  SandboxSessionSocketReadyStates,
  type SandboxSessionSocketEventName,
} from "./runtime.js";

function toReadyState(value: number): SandboxSessionSocket["readyState"] {
  switch (value) {
    case SandboxSessionSocketReadyStates.CONNECTING:
    case SandboxSessionSocketReadyStates.OPEN:
    case SandboxSessionSocketReadyStates.CLOSING:
    case SandboxSessionSocketReadyStates.CLOSED:
      return value;
    default:
      throw new Error(`Unsupported browser websocket ready state '${String(value)}'.`);
  }
}

class BrowserSandboxSessionSocket implements SandboxSessionSocket {
  readonly #socket: WebSocket;
  readonly #listenerMap = new Map<
    SandboxSessionSocketEventMap[SandboxSessionSocketEventName],
    EventListener
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
    const wrappedListener: EventListener = (event) => {
      listener(event);
    };

    this.#listenerMap.set(listener, wrappedListener);
    this.#socket.addEventListener(eventName, wrappedListener);
  }

  removeEventListener<EventName extends SandboxSessionSocketEventName>(
    eventName: EventName,
    listener: SandboxSessionSocketEventMap[EventName],
  ): void {
    const wrappedListener = this.#listenerMap.get(listener);
    if (wrappedListener === undefined) {
      return;
    }

    this.#listenerMap.delete(listener);
    this.#socket.removeEventListener(eventName, wrappedListener);
  }

  send(payload: string): void {
    this.#socket.send(payload);
  }

  close(code?: number, reason?: string): void {
    this.#socket.close(code, reason);
  }
}

class BrowserSandboxScheduledTask implements SandboxScheduledTask {
  readonly #timeoutId: number;

  constructor(timeoutId: number) {
    this.#timeoutId = timeoutId;
  }

  cancel(): void {
    window.clearTimeout(this.#timeoutId);
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

export function createBrowserSandboxSessionRuntime(): SandboxSessionRuntime {
  const createStreamId = createSequentialStreamId();

  return {
    createSocket: (connectionUrl) => new BrowserSandboxSessionSocket(connectionUrl),
    createStreamId,
    scheduleTimeout: (callback, timeoutMs) =>
      new BrowserSandboxScheduledTask(window.setTimeout(callback, timeoutMs)),
  };
}
