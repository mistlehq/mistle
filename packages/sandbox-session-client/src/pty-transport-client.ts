import {
  parseStreamControlMessage,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";

import {
  SandboxPtyStates,
  type SandboxPtyExitInfo,
  type SandboxPtyOpenOptions,
  type SandboxPtyResetInfo,
  type SandboxPtyState,
} from "./pty-types.js";
import {
  SandboxSessionSocketReadyStates,
  type SandboxScheduledTask,
  type SandboxSessionRuntime,
  type SandboxSessionSocket,
} from "./runtime.js";

const DirectPtyStreamId = 1;
const DefaultConnectTimeoutMs = 30_000;
const TextEncoderInstance = new TextEncoder();

export type PtyTransportClientInput = {
  connectionUrl: string;
  runtime: SandboxSessionRuntime;
  connectTimeoutMs?: number;
};

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && Number.isFinite(value) && value > 0;
}

function assertValidPtyDimensions(
  input: { cols: number; rows: number },
  operation: "open" | "resize",
): void {
  if (!isPositiveInteger(input.cols) || !isPositiveInteger(input.rows)) {
    const operationLabel = operation === "open" ? "open size" : "resize";
    throw new Error(`Sandbox PTY ${operationLabel} must use positive integer rows and columns.`);
  }
}

function createPtyTransportOpenMessage(options: SandboxPtyOpenOptions): string {
  const args = options.args?.filter((value) => value.trim().length > 0);
  return JSON.stringify({
    type: "pty.transport.open",
    launch: {
      session: "create",
      cols: options.cols,
      rows: options.rows,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.command === undefined ? {} : { command: options.command }),
      ...(args === undefined || args.length === 0 ? {} : { args }),
    },
  });
}

function createPtyResizeMessage(input: { cols: number; rows: number }): string {
  return JSON.stringify({
    type: "stream.signal",
    streamId: DirectPtyStreamId,
    signal: {
      type: "pty.resize",
      cols: input.cols,
      rows: input.rows,
    },
  });
}

function createPtyCloseMessage(): string {
  return JSON.stringify({
    type: "stream.close",
    streamId: DirectPtyStreamId,
  });
}

function readMessageEventPayload(event: unknown): unknown {
  if (typeof event === "object" && event !== null && "data" in event) {
    return event.data;
  }

  return event;
}

function isCrossRealmArrayBuffer(value: unknown): value is ArrayBuffer {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.toString.call(value) === "[object ArrayBuffer]" &&
    "byteLength" in value &&
    typeof value.byteLength === "number"
  );
}

function readBinaryPayload(value: unknown): ArrayBuffer | ArrayBufferView | null {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || isCrossRealmArrayBuffer(value)) {
    return value;
  }

  return null;
}

function toUint8Array(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  return new Uint8Array(value);
}

function normalizeSocketCloseEvent(event: unknown): { code: number; reason: string } {
  if (typeof event === "number") {
    return {
      code: event,
      reason: "",
    };
  }

  if (typeof event !== "object" || event === null) {
    return {
      code: 1006,
      reason: "",
    };
  }

  const code = "code" in event && typeof event.code === "number" ? event.code : 1006;
  const reason = "reason" in event && typeof event.reason === "string" ? event.reason : "";
  return { code, reason };
}

function createStreamResetError(input: SandboxPtyResetInfo): Error {
  return new Error(`Sandbox PTY stream reset (${input.code}): ${input.message}`);
}

export class PtyTransportClient {
  readonly #connectionUrl: string;
  readonly #connectTimeoutMs: number;
  readonly #dataListeners = new Set<(chunk: Uint8Array) => void>();
  readonly #errorListeners = new Set<(error: Error) => void>();
  readonly #exitListeners = new Set<(info: SandboxPtyExitInfo) => void>();
  readonly #resetListeners = new Set<(info: SandboxPtyResetInfo) => void>();
  readonly #runtime: SandboxSessionRuntime;
  readonly #stateListeners = new Set<(state: SandboxPtyState) => void>();

  #error: Error | null = null;
  #exitInfo: SandboxPtyExitInfo | null = null;
  #resetInfo: SandboxPtyResetInfo | null = null;
  #socket: SandboxSessionSocket | null = null;
  #state: SandboxPtyState = SandboxPtyStates.IDLE;

  constructor(input: PtyTransportClientInput) {
    this.#connectionUrl = input.connectionUrl;
    this.#runtime = input.runtime;
    this.#connectTimeoutMs = input.connectTimeoutMs ?? DefaultConnectTimeoutMs;
  }

  get state(): SandboxPtyState {
    return this.#state;
  }

  get error(): Error | null {
    return this.#error;
  }

  get exitInfo(): SandboxPtyExitInfo | null {
    return this.#exitInfo;
  }

  get resetInfo(): SandboxPtyResetInfo | null {
    return this.#resetInfo;
  }

  onState(listener: (state: SandboxPtyState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => {
      this.#stateListeners.delete(listener);
    };
  }

  onData(listener: (chunk: Uint8Array) => void): () => void {
    this.#dataListeners.add(listener);
    return () => {
      this.#dataListeners.delete(listener);
    };
  }

  onExit(listener: (info: SandboxPtyExitInfo) => void): () => void {
    this.#exitListeners.add(listener);
    return () => {
      this.#exitListeners.delete(listener);
    };
  }

  onReset(listener: (info: SandboxPtyResetInfo) => void): () => void {
    this.#resetListeners.add(listener);
    return () => {
      this.#resetListeners.delete(listener);
    };
  }

  onError(listener: (error: Error) => void): () => void {
    this.#errorListeners.add(listener);
    return () => {
      this.#errorListeners.delete(listener);
    };
  }

  async open(options: SandboxPtyOpenOptions): Promise<void> {
    if (options.ptySessionId.trim().length === 0) {
      throw new Error("Sandbox PTY session id is required.");
    }
    assertValidPtyDimensions(options, "open");
    if (this.#state !== SandboxPtyStates.IDLE) {
      throw new Error("Sandbox PTY transport can only open from the idle state.");
    }

    this.#setState(SandboxPtyStates.CONNECTING);
    const socket = this.#runtime.createSocket(this.#connectionUrl);
    this.#socket = socket;
    this.#attachSocketListeners(socket);

    try {
      await this.#waitForOpen(socket);
      await socket.send(createPtyTransportOpenMessage(options));
      this.#setState(SandboxPtyStates.OPEN);
    } catch (error) {
      const resolvedError =
        error instanceof Error ? error : new Error("Could not open sandbox PTY transport.");
      this.#setErrorState(resolvedError);
      socket.close(1011, resolvedError.message);
      throw resolvedError;
    }
  }

  async write(data: Uint8Array | string): Promise<void> {
    const socket = this.#requireOpenSocket();
    await socket.send(typeof data === "string" ? TextEncoderInstance.encode(data) : data);
  }

  async resize(input: { cols: number; rows: number }): Promise<void> {
    assertValidPtyDimensions(input, "resize");
    await this.#requireOpenSocket().send(createPtyResizeMessage(input));
  }

  async close(): Promise<void> {
    const socket = this.#requireOpenSocket();
    this.#setState(SandboxPtyStates.CLOSING);
    await socket.send(createPtyCloseMessage());
    socket.close(1000, "Sandbox PTY transport closed.");
    this.#setState(SandboxPtyStates.CLOSED);
  }

  async disconnect(): Promise<void> {
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null && socket.readyState !== SandboxSessionSocketReadyStates.CLOSED) {
      socket.close(1000, "Sandbox PTY transport disconnected.");
    }
    this.#setState(SandboxPtyStates.CLOSED);
  }

  #requireOpenSocket(): SandboxSessionSocket {
    const socket = this.#socket;
    if (
      this.#state !== SandboxPtyStates.OPEN ||
      socket === null ||
      socket.readyState !== SandboxSessionSocketReadyStates.OPEN
    ) {
      throw new Error("Sandbox PTY transport is not open.");
    }

    return socket;
  }

  async #waitForOpen(socket: SandboxSessionSocket): Promise<void> {
    if (socket.readyState === SandboxSessionSocketReadyStates.OPEN) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let timeoutTask: SandboxScheduledTask | null = null;
      const cleanup = (): void => {
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
        timeoutTask?.cancel();
      };
      const handleOpen = (): void => {
        cleanup();
        resolve();
      };
      const handleError = (event: unknown): void => {
        cleanup();
        reject(event instanceof Error ? event : new Error("Sandbox PTY transport socket error."));
      };
      const handleClose = (event: unknown): void => {
        cleanup();
        const close = normalizeSocketCloseEvent(event);
        reject(
          new Error(
            `Sandbox PTY transport closed before opening (${String(close.code)}): ${close.reason}`,
          ),
        );
      };
      timeoutTask = this.#runtime.scheduleTimeout(() => {
        cleanup();
        reject(new Error("Timed out while opening sandbox PTY transport."));
      }, this.#connectTimeoutMs);

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
    });
  }

  #attachSocketListeners(socket: SandboxSessionSocket): void {
    socket.addEventListener("message", this.#handleSocketMessage);
    socket.addEventListener("close", this.#handleSocketClose);
    socket.addEventListener("error", this.#handleSocketError);
  }

  #detachSocketListeners(socket: SandboxSessionSocket): void {
    socket.removeEventListener("message", this.#handleSocketMessage);
    socket.removeEventListener("close", this.#handleSocketClose);
    socket.removeEventListener("error", this.#handleSocketError);
  }

  readonly #handleSocketMessage = (event: unknown): void => {
    const payload = readMessageEventPayload(event);
    if (typeof payload === "string") {
      this.#handleTextMessage(payload);
      return;
    }

    const binaryPayload = readBinaryPayload(payload);
    if (binaryPayload === null) {
      this.#setErrorState(
        new Error("Sandbox PTY transport message payload type is not supported."),
      );
      this.#socket?.close(1008, "Unsupported PTY transport payload.");
      return;
    }

    const chunk = toUint8Array(binaryPayload);
    for (const listener of this.#dataListeners) {
      listener(chunk);
    }
  };

  #handleTextMessage(payload: string): void {
    const controlMessage = parseStreamControlMessage(payload);
    if (controlMessage === undefined) {
      this.#setErrorState(new Error("Sandbox PTY transport text payload was not valid control."));
      this.#socket?.close(1008, "Invalid PTY transport control payload.");
      return;
    }

    this.#handleControlMessage(controlMessage);
  }

  #handleControlMessage(message: StreamControlMessage): void {
    if (message.type === "stream.event" && message.event.type === "pty.exit") {
      this.#exitInfo = {
        exitCode: message.event.exitCode,
      };
      for (const listener of this.#exitListeners) {
        listener(this.#exitInfo);
      }
      this.#setState(SandboxPtyStates.EXITED);
      return;
    }

    if (message.type === "stream.reset") {
      this.#resetInfo = {
        code: message.code,
        message: message.message,
      };
      for (const listener of this.#resetListeners) {
        listener(this.#resetInfo);
      }
      this.#setErrorState(createStreamResetError(this.#resetInfo));
      return;
    }

    if (message.type === "stream.complete") {
      this.#setState(SandboxPtyStates.CLOSED);
    }
  }

  readonly #handleSocketClose = (event: unknown): void => {
    const socket = this.#socket;
    if (socket !== null) {
      this.#detachSocketListeners(socket);
    }
    this.#socket = null;
    const close = normalizeSocketCloseEvent(event);
    if (this.#state === SandboxPtyStates.CLOSING || close.code === 1000) {
      this.#setState(SandboxPtyStates.CLOSED);
      return;
    }
    this.#setErrorState(
      new Error(`Sandbox PTY transport closed (${String(close.code)}): ${close.reason}`),
    );
  };

  readonly #handleSocketError = (event: unknown): void => {
    this.#setErrorState(event instanceof Error ? event : new Error("Sandbox PTY transport error."));
  };

  #setState(state: SandboxPtyState): void {
    this.#state = state;
    for (const listener of this.#stateListeners) {
      listener(state);
    }
  }

  #setErrorState(error: Error): void {
    this.#error = error;
    this.#setState(SandboxPtyStates.ERROR);
    for (const listener of this.#errorListeners) {
      listener(error);
    }
  }
}
