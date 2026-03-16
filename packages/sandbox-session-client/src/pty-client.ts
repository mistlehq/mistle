import {
  decodeDataFrame,
  DefaultStreamWindowBytes,
  encodeDataFrame,
  MaxStreamWindowBytes,
  parseStreamControlMessage,
  PayloadKindRawBytes,
  type StreamClose,
  type StreamControlMessage,
  type StreamOpen,
  type StreamSignalMessage,
} from "@mistle/sandbox-session-protocol";

import {
  SandboxPtyStates,
  type SandboxPtyClientInput,
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

const DefaultConnectTimeoutMs = 15_000;
const DefaultCloseTimeoutMs = 500;
const ProtocolViolationCloseCode = 1008;
const TextEncoderInstance = new TextEncoder();

type PendingOpen = {
  streamId: number;
  timeoutTask: SandboxScheduledTask;
  resolve: () => void;
  reject: (error: Error) => void;
};

type PendingClose = {
  streamId: number;
  timeoutTask: SandboxScheduledTask;
  resolve: () => void;
  reject: (error: Error) => void;
};

function readTextPayload(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readBinaryPayload(value: unknown): ArrayBuffer | Uint8Array | null {
  if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
    return value;
  }

  return null;
}

function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function readMessageEventPayload(event: unknown): unknown {
  if (typeof event === "object" && event !== null && "data" in event) {
    return event.data;
  }

  return event;
}

function createPtyOpenMessage(input: {
  options: SandboxPtyOpenOptions;
  streamId: number;
}): StreamOpen {
  return {
    type: "stream.open",
    streamId: input.streamId,
    channel: {
      kind: "pty",
      session: "create",
      cols: input.options.cols,
      rows: input.options.rows,
      ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
    },
  };
}

function createPtyResizeMessage(input: {
  cols: number;
  rows: number;
  streamId: number;
}): StreamSignalMessage {
  return {
    type: "stream.signal",
    streamId: input.streamId,
    signal: {
      type: "pty.resize",
      cols: input.cols,
      rows: input.rows,
    },
  };
}

function createStreamCloseMessage(streamId: number): StreamClose {
  return {
    type: "stream.close",
    streamId,
  };
}

function createStreamResetError(input: SandboxPtyResetInfo): Error {
  return new Error(`Sandbox PTY stream reset (${input.code}): ${input.message}`);
}

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

export class SandboxPtyClient {
  readonly #connectionUrl: string;
  readonly #runtime: SandboxSessionRuntime;
  readonly #connectTimeoutMs: number;
  readonly #closeTimeoutMs: number;
  readonly #stateListeners = new Set<(state: SandboxPtyState) => void>();
  readonly #dataListeners = new Set<(chunk: Uint8Array) => void>();
  readonly #exitListeners = new Set<(info: SandboxPtyExitInfo) => void>();
  readonly #resetListeners = new Set<(info: SandboxPtyResetInfo) => void>();
  readonly #errorListeners = new Set<(error: Error) => void>();

  #socket: SandboxSessionSocket | null = null;
  #state: SandboxPtyState = SandboxPtyStates.IDLE;
  #streamId: number | null = null;
  #error: Error | null = null;
  #exitInfo: SandboxPtyExitInfo | null = null;
  #resetInfo: SandboxPtyResetInfo | null = null;
  #availableSendWindowBytes = 0;
  #pendingOpen: PendingOpen | null = null;
  #pendingClose: PendingClose | null = null;
  #disconnectPromise: Promise<void> | null = null;
  #disconnectResolve: (() => void) | null = null;

  constructor(input: SandboxPtyClientInput) {
    this.#connectionUrl = input.connectionUrl;
    this.#runtime = input.runtime;
    this.#connectTimeoutMs = input.connectTimeoutMs ?? DefaultConnectTimeoutMs;
    this.#closeTimeoutMs = input.closeTimeoutMs ?? DefaultCloseTimeoutMs;
  }

  get state(): SandboxPtyState {
    return this.#state;
  }

  get streamId(): number | null {
    return this.#streamId;
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

  async connect(): Promise<void> {
    if (this.#state !== SandboxPtyStates.IDLE || this.#socket !== null) {
      throw new Error("Sandbox PTY client can only connect from the idle state.");
    }

    this.#setState(SandboxPtyStates.CONNECTING);
    const socket = this.#runtime.createSocket(this.#connectionUrl);
    this.#socket = socket;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeoutTask = this.#runtime.scheduleTimeout(() => {
        fail(new Error("Timed out while connecting the sandbox PTY websocket."));
      }, this.#connectTimeoutMs);

      const cleanup = (): void => {
        timeoutTask.cancel();
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
      };

      const fail = (error: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        this.#socket = null;
        if (this.#disconnectPromise !== null) {
          this.#setState(SandboxPtyStates.CLOSED);
        } else {
          this.#setErrorState(error);
        }
        socket.close();
        this.#resolveDisconnectWaiters();
        reject(error);
      };

      const handleOpen = (): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        socket.addEventListener("message", this.#handleSocketMessage);
        socket.addEventListener("close", this.#handleSocketClose);
        socket.addEventListener("error", this.#handleSocketError);
        this.#setState(SandboxPtyStates.CONNECTED);
        resolve();
      };

      const handleError = (): void => {
        fail(new Error("Sandbox PTY websocket connection failed."));
      };

      const handleClose = (): void => {
        fail(new Error("Sandbox PTY websocket connection closed before becoming ready."));
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
    });
  }

  async open(options: SandboxPtyOpenOptions): Promise<void> {
    assertValidPtyDimensions(options, "open");
    if (this.#state !== SandboxPtyStates.CONNECTED) {
      throw new Error("Sandbox PTY stream can only open from the connected state.");
    }

    const socket = this.#socket;
    if (socket === null || socket.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox PTY websocket is not open.");
    }

    const streamId = this.#runtime.createStreamId();
    this.#setState(SandboxPtyStates.OPENING);
    this.#error = null;
    this.#exitInfo = null;
    this.#resetInfo = null;

    const openPromise = new Promise<void>((resolve, reject) => {
      const timeoutTask = this.#runtime.scheduleTimeout(() => {
        fail(new Error("Timed out while opening the sandbox PTY stream."));
      }, this.#connectTimeoutMs);

      const succeed = (): void => {
        this.#pendingOpen = null;
        this.#streamId = streamId;
        this.#availableSendWindowBytes = DefaultStreamWindowBytes;
        this.#setState(SandboxPtyStates.OPEN);
        resolve();
      };

      const fail = (error: Error): void => {
        this.#pendingOpen = null;
        this.#clearActiveStreamState();
        this.#error = error;
        if (
          this.#socket !== null &&
          this.#socket.readyState === SandboxSessionSocketReadyStates.OPEN
        ) {
          this.#setState(SandboxPtyStates.CONNECTED);
        } else {
          this.#setErrorState(error);
        }
        reject(error);
      };

      this.#pendingOpen = {
        streamId,
        timeoutTask,
        resolve: succeed,
        reject: fail,
      };
    });

    try {
      await socket.send(JSON.stringify(createPtyOpenMessage({ options, streamId })));
    } catch (error) {
      const resolvedError =
        error instanceof Error ? error : new Error("Failed to send sandbox PTY stream.open.");
      this.#rejectPendingOpen(resolvedError);
      throw resolvedError;
    }

    await openPromise;
  }

  async write(data: Uint8Array | string): Promise<void> {
    if (this.#state !== SandboxPtyStates.OPEN) {
      throw new Error("Sandbox PTY stream is not open.");
    }

    const socket = this.#socket;
    const streamId = this.#streamId;
    if (
      socket === null ||
      socket.readyState !== SandboxSessionSocketReadyStates.OPEN ||
      streamId === null
    ) {
      throw new Error("Sandbox PTY websocket is not open.");
    }

    const payload = typeof data === "string" ? TextEncoderInstance.encode(data) : data;
    if (payload.byteLength > this.#availableSendWindowBytes) {
      throw new Error("Sandbox PTY stream send window is exhausted.");
    }

    this.#availableSendWindowBytes -= payload.byteLength;
    try {
      await socket.send(
        encodeDataFrame({
          streamId,
          payloadKind: PayloadKindRawBytes,
          payload,
        }),
      );
    } catch (error) {
      this.#availableSendWindowBytes += payload.byteLength;
      const resolvedError =
        error instanceof Error ? error : new Error("Failed to send sandbox PTY input payload.");
      this.#closeConnectedSocketWithError(resolvedError);
      throw resolvedError;
    }
  }

  async resize(input: { cols: number; rows: number }): Promise<void> {
    assertValidPtyDimensions(input, "resize");
    if (this.#state !== SandboxPtyStates.OPEN) {
      throw new Error("Sandbox PTY stream is not open.");
    }

    const socket = this.#socket;
    const streamId = this.#streamId;
    if (
      socket === null ||
      socket.readyState !== SandboxSessionSocketReadyStates.OPEN ||
      streamId === null
    ) {
      throw new Error("Sandbox PTY websocket is not open.");
    }

    await socket.send(JSON.stringify(createPtyResizeMessage({ ...input, streamId })));
  }

  async close(): Promise<void> {
    if (this.#state !== SandboxPtyStates.OPEN) {
      throw new Error("Sandbox PTY stream is not open.");
    }

    const socket = this.#socket;
    const streamId = this.#streamId;
    if (
      socket === null ||
      socket.readyState !== SandboxSessionSocketReadyStates.OPEN ||
      streamId === null
    ) {
      throw new Error("Sandbox PTY websocket is not open.");
    }

    this.#setState(SandboxPtyStates.CLOSING);

    const closePromise = new Promise<void>((resolve, reject) => {
      const timeoutError = new Error("Timed out while waiting for sandbox PTY close confirmation.");
      const timeoutTask = this.#runtime.scheduleTimeout(() => {
        const pendingClose = this.#pendingClose;
        if (pendingClose === null || pendingClose.streamId !== streamId) {
          return;
        }

        reject(timeoutError);
      }, this.#closeTimeoutMs);

      const succeed = (): void => {
        this.#pendingClose = null;
        this.#clearActiveStreamState();
        this.#setState(SandboxPtyStates.CONNECTED);
        resolve();
      };

      const fail = (error: Error): void => {
        this.#pendingClose = null;
        this.#clearActiveStreamState();
        this.#setErrorState(error);
        reject(error);
      };

      this.#pendingClose = {
        streamId,
        timeoutTask,
        resolve: succeed,
        reject: fail,
      };
    });

    try {
      await socket.send(JSON.stringify(createStreamCloseMessage(streamId)));
    } catch (error) {
      const resolvedError =
        error instanceof Error ? error : new Error("Failed to send sandbox PTY stream.close.");
      this.#rejectPendingClose(resolvedError);
      throw resolvedError;
    }

    await closePromise;
  }

  async disconnect(): Promise<void> {
    const socket = this.#socket;
    if (socket === null) {
      if (this.#state === SandboxPtyStates.IDLE) {
        this.#setState(SandboxPtyStates.CLOSED);
      }
      return;
    }

    if (this.#disconnectPromise !== null) {
      await this.#disconnectPromise;
      return;
    }

    this.#disconnectPromise = new Promise<void>((resolve) => {
      this.#disconnectResolve = resolve;
    });

    socket.close(1000, "Sandbox PTY client disconnected.");
    await this.#disconnectPromise;
  }

  readonly #handleSocketMessage = (event: unknown): void => {
    const payload = readMessageEventPayload(event);
    const textPayload = readTextPayload(payload);
    if (textPayload !== null) {
      this.#handleControlPayload(textPayload);
      return;
    }

    const binaryPayload = readBinaryPayload(payload);
    if (binaryPayload === null) {
      return;
    }

    this.#handleDataFrame(toUint8Array(binaryPayload));
  };

  readonly #handleSocketClose = (): void => {
    this.#socket = null;
    this.#clearActiveStreamState();
    this.#rejectPendingOpen(new Error("Sandbox PTY websocket closed before the stream was ready."));

    const pendingClose = this.#pendingClose;
    this.#pendingClose = null;
    if (pendingClose !== null) {
      pendingClose.timeoutTask.cancel();
      pendingClose.reject(
        new Error("Sandbox PTY websocket closed before close confirmation was received."),
      );
    }

    if (this.#state !== SandboxPtyStates.ERROR && this.#state !== SandboxPtyStates.CLOSED) {
      this.#setState(SandboxPtyStates.CLOSED);
    }

    this.#resolveDisconnectWaiters();
  };

  readonly #handleSocketError = (): void => {
    this.#setErrorState(new Error("Sandbox PTY websocket connection failed."));
  };

  #handleControlPayload(payload: string): void {
    const controlMessage = parseStreamControlMessage(payload);
    if (controlMessage === undefined) {
      if (this.#streamId !== null || this.#pendingOpen !== null || this.#pendingClose !== null) {
        this.#closeConnectedSocketWithError(
          new Error("Received malformed sandbox PTY control payload."),
        );
      }
      return;
    }

    if (this.#resolvePendingOpen(controlMessage)) {
      return;
    }
    const activeStreamId = this.#streamId;
    const closingStreamId = this.#pendingClose?.streamId ?? null;
    if (
      (activeStreamId === null || controlMessage.streamId !== activeStreamId) &&
      (closingStreamId === null || controlMessage.streamId !== closingStreamId)
    ) {
      return;
    }

    if (controlMessage.type === "stream.window") {
      const nextAvailableSendWindowBytes = this.#availableSendWindowBytes + controlMessage.bytes;
      if (nextAvailableSendWindowBytes > MaxStreamWindowBytes) {
        this.#closeConnectedSocketWithError(
          new Error(
            `Sandbox PTY stream send window exceeds the configured maximum of ${String(MaxStreamWindowBytes)} bytes.`,
          ),
        );
        return;
      }

      this.#availableSendWindowBytes = nextAvailableSendWindowBytes;
      return;
    }

    if (controlMessage.type === "stream.event" && controlMessage.event.type === "pty.exit") {
      this.#handleExit({
        exitCode: controlMessage.event.exitCode,
      });
      return;
    }

    if (controlMessage.type === "stream.reset") {
      this.#handleReset({
        code: controlMessage.code,
        message: controlMessage.message,
      });
    }
  }

  #handleDataFrame(payload: Uint8Array): void {
    let dataFrame: ReturnType<typeof decodeDataFrame>;
    try {
      dataFrame = decodeDataFrame(payload);
    } catch {
      if (this.#streamId !== null) {
        this.#closeConnectedSocketWithError(
          new Error("Received malformed sandbox PTY data frame."),
        );
      }
      return;
    }

    if (this.#streamId === null || dataFrame.streamId !== this.#streamId) {
      return;
    }

    if (dataFrame.payloadKind !== PayloadKindRawBytes) {
      this.#closeConnectedSocketWithError(
        new Error("Sandbox PTY stream received an unsupported data payload kind."),
      );
      return;
    }

    this.#sendReceiveWindowUpdate(dataFrame.payload.byteLength);
    for (const listener of this.#dataListeners) {
      listener(dataFrame.payload);
    }
  }

  #resolvePendingOpen(controlMessage: StreamControlMessage): boolean {
    const pendingOpen = this.#pendingOpen;
    if (pendingOpen === null || controlMessage.streamId !== pendingOpen.streamId) {
      return false;
    }

    if (controlMessage.type === "stream.open.ok") {
      pendingOpen.timeoutTask.cancel();
      pendingOpen.resolve();
      return true;
    }

    if (controlMessage.type === "stream.open.error") {
      pendingOpen.timeoutTask.cancel();
      pendingOpen.reject(new Error(controlMessage.message));
      return true;
    }

    if (controlMessage.type === "stream.reset") {
      pendingOpen.timeoutTask.cancel();
      const resetInfo = {
        code: controlMessage.code,
        message: controlMessage.message,
      };
      this.#resetInfo = resetInfo;
      for (const listener of this.#resetListeners) {
        listener(resetInfo);
      }
      pendingOpen.reject(createStreamResetError(resetInfo));
      return true;
    }

    return false;
  }

  #handleExit(exitInfo: SandboxPtyExitInfo): void {
    this.#exitInfo = exitInfo;
    this.#clearActiveStreamState();
    for (const listener of this.#exitListeners) {
      listener(exitInfo);
    }

    const pendingClose = this.#pendingClose;
    if (pendingClose !== null) {
      pendingClose.timeoutTask.cancel();
      pendingClose.resolve();
      return;
    }

    this.#setState(SandboxPtyStates.CONNECTED);
  }

  #handleReset(resetInfo: SandboxPtyResetInfo): void {
    this.#resetInfo = resetInfo;
    this.#clearActiveStreamState();
    for (const listener of this.#resetListeners) {
      listener(resetInfo);
    }

    const resetError = createStreamResetError(resetInfo);
    this.#error = resetError;
    if (this.#pendingClose !== null) {
      this.#rejectPendingClose(resetError);
      return;
    }

    if (this.#socket !== null && this.#socket.readyState === SandboxSessionSocketReadyStates.OPEN) {
      this.#setState(SandboxPtyStates.CONNECTED);
      return;
    }

    this.#setErrorState(resetError);
  }

  #sendReceiveWindowUpdate(bytes: number): void {
    const socket = this.#socket;
    const streamId = this.#streamId;
    if (
      socket === null ||
      socket.readyState !== SandboxSessionSocketReadyStates.OPEN ||
      streamId === null ||
      bytes <= 0
    ) {
      return;
    }

    void socket
      .send(
        JSON.stringify({
          type: "stream.window",
          streamId,
          bytes,
        }),
      )
      .catch(() => {
        this.#closeConnectedSocketWithError(
          new Error("Failed to send sandbox PTY stream.window acknowledgement."),
        );
      });
  }

  #rejectPendingOpen(error: Error): void {
    const pendingOpen = this.#pendingOpen;
    if (pendingOpen === null) {
      return;
    }

    pendingOpen.timeoutTask.cancel();
    pendingOpen.reject(error);
  }

  #rejectPendingClose(error: Error): void {
    const pendingClose = this.#pendingClose;
    if (pendingClose === null) {
      return;
    }

    pendingClose.timeoutTask.cancel();
    pendingClose.reject(error);
  }

  #closeConnectedSocketWithError(error: Error): void {
    const socket = this.#socket;
    this.#socket = null;
    this.#clearActiveStreamState();

    this.#rejectPendingOpen(error);
    this.#rejectPendingClose(error);

    if (socket !== null) {
      socket.removeEventListener("message", this.#handleSocketMessage);
      socket.removeEventListener("close", this.#handleSocketClose);
      socket.removeEventListener("error", this.#handleSocketError);
      socket.close(ProtocolViolationCloseCode, error.message);
    }

    this.#setErrorState(error);

    const disconnectResolve = this.#disconnectResolve;
    this.#disconnectResolve = null;
    this.#disconnectPromise = null;
    if (disconnectResolve !== null) {
      disconnectResolve();
    }
  }

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

  #clearActiveStreamState(): void {
    this.#streamId = null;
    this.#availableSendWindowBytes = 0;
  }

  #resolveDisconnectWaiters(): void {
    const disconnectResolve = this.#disconnectResolve;
    this.#disconnectResolve = null;
    this.#disconnectPromise = null;
    if (disconnectResolve !== null) {
      disconnectResolve();
    }
  }
}

export function createSandboxPtyClient(input: SandboxPtyClientInput): SandboxPtyClient {
  return new SandboxPtyClient(input);
}
