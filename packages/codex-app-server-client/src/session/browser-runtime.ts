import {
  type CodexScheduledTask,
  type CodexSessionRuntime,
  type CodexSessionSocket,
  type CodexSessionSocketEventMap,
  CodexSessionSocketReadyStates,
  type CodexSessionSocketEventName,
} from "./runtime.js";

function toReadyState(value: number): CodexSessionSocket["readyState"] {
  switch (value) {
    case CodexSessionSocketReadyStates.CONNECTING:
    case CodexSessionSocketReadyStates.OPEN:
    case CodexSessionSocketReadyStates.CLOSING:
    case CodexSessionSocketReadyStates.CLOSED:
      return value;
    default:
      throw new Error(`Unsupported browser websocket ready state '${String(value)}'.`);
  }
}

class BrowserCodexSessionSocket implements CodexSessionSocket {
  readonly #socket: WebSocket;
  readonly #listenerMap = new Map<
    CodexSessionSocketEventMap[CodexSessionSocketEventName],
    EventListener
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
    let wrappedListener: EventListener;
    if (eventName === "message") {
      wrappedListener = (event) => {
        listener(event);
      };
    } else {
      wrappedListener = (event) => {
        listener(event);
      };
    }

    this.#listenerMap.set(listener, wrappedListener);
    this.#socket.addEventListener(eventName, wrappedListener);
  }

  removeEventListener<EventName extends CodexSessionSocketEventName>(
    eventName: EventName,
    listener: CodexSessionSocketEventMap[EventName],
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

class BrowserCodexScheduledTask implements CodexScheduledTask {
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

export function createBrowserCodexSessionRuntime(): CodexSessionRuntime {
  const createStreamId = createSequentialStreamId();

  return {
    createSocket: (connectionUrl) => new BrowserCodexSessionSocket(connectionUrl),
    createStreamId,
    scheduleTimeout: (callback, timeoutMs) =>
      new BrowserCodexScheduledTask(window.setTimeout(callback, timeoutMs)),
  };
}
