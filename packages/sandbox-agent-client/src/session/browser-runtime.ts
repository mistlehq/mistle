import {
  type SandboxAgentScheduledTask,
  type SandboxAgentRuntime,
  type SandboxAgentSocket,
  type SandboxAgentSocketEventMap,
  SandboxAgentSocketReadyStates,
  type SandboxAgentSocketEventName,
} from "./runtime.js";

function toReadyState(value: number): SandboxAgentSocket["readyState"] {
  switch (value) {
    case SandboxAgentSocketReadyStates.CONNECTING:
    case SandboxAgentSocketReadyStates.OPEN:
    case SandboxAgentSocketReadyStates.CLOSING:
    case SandboxAgentSocketReadyStates.CLOSED:
      return value;
    default:
      throw new Error(`Unsupported browser websocket ready state '${String(value)}'.`);
  }
}

class BrowserSandboxAgentSocket implements SandboxAgentSocket {
  readonly #socket: WebSocket;
  readonly #listenerMap = new Map<
    SandboxAgentSocketEventMap[SandboxAgentSocketEventName],
    EventListener
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

  removeEventListener<EventName extends SandboxAgentSocketEventName>(
    eventName: EventName,
    listener: SandboxAgentSocketEventMap[EventName],
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

class BrowserSandboxAgentScheduledTask implements SandboxAgentScheduledTask {
  readonly #timeoutId: number;

  constructor(timeoutId: number) {
    this.#timeoutId = timeoutId;
  }

  cancel(): void {
    window.clearTimeout(this.#timeoutId);
  }
}

export function createBrowserSandboxAgentRuntime(): SandboxAgentRuntime {
  return {
    createSocket: (connectionUrl) => new BrowserSandboxAgentSocket(connectionUrl),
    createRequestId: () => crypto.randomUUID(),
    scheduleTimeout: (callback, timeoutMs) =>
      new BrowserSandboxAgentScheduledTask(window.setTimeout(callback, timeoutMs)),
  };
}
