import {
  decodeDataFrame,
  DefaultStreamWindowBytes,
  encodeDataFrame,
  MaxStreamWindowBytes,
  parseBootstrapControlMessage,
  parsePortsControlMessage,
  parseStreamControlMessage,
  PayloadKindRawBytes,
  PayloadKindWebSocketBinary,
  PayloadKindWebSocketText,
  type BootstrapControlMessage,
  type PortsControlMessage,
  type StreamChannel,
  type StreamControlMessage,
  type StreamDataFrame,
  type StreamOpen,
  type StreamOpenError,
  type StreamOpenOK,
} from "@mistle/sandbox-session-protocol";

import {
  SandboxSessionSocketReadyStates,
  type SandboxScheduledTask,
  type SandboxSessionRuntime,
  type SandboxSessionSendGuarantee,
  type SandboxSessionSocket,
} from "./runtime.js";

const DefaultConnectTimeoutMs = 30_000;
const ProtocolViolationCloseCode = 4008;

export type SandboxSessionTransportEvent =
  | {
      type: "close";
      code: number;
      reason: string;
      wasClean: boolean;
    }
  | {
      type: "error";
      error: Error;
    }
  | {
      type: "unhandled_control";
      message: BootstrapControlMessage | PortsControlMessage | StreamControlMessage;
    }
  | {
      type: "unhandled_data";
      frame: StreamDataFrame;
    };

export type SandboxSessionTransportInput = {
  runtime: SandboxSessionRuntime;
  connectTimeoutMs?: number;
};

export class SandboxSessionStreamOpenError extends Error {
  readonly openError: StreamOpenError;

  constructor(openError: StreamOpenError) {
    super(
      `Sandbox session stream.open request was rejected (${openError.code}): ${openError.message}`,
    );
    this.name = "SandboxSessionStreamOpenError";
    this.openError = openError;
  }
}

export type SandboxSessionStreamState =
  | "opening"
  | "open"
  | "closed"
  | "reset"
  | "transport_closed";

export type SandboxSessionStreamEvent =
  | {
      type: "state_changed";
      state: SandboxSessionStreamState;
      errorMessage: string | null;
    }
  | {
      type: "control";
      message: StreamControlMessage;
    }
  | {
      type: "data";
      frame: StreamDataFrame;
    };

type SandboxSessionOutboundControlMessage = Extract<
  StreamControlMessage,
  { type: "stream.close" | "stream.signal" | "stream.window" }
>;

type SandboxSessionOutboundControlMessageInput =
  | {
      type: "stream.close";
    }
  | {
      type: "stream.signal";
      signal: Extract<StreamControlMessage, { type: "stream.signal" }>["signal"];
    }
  | {
      type: "stream.window";
      bytes: number;
    };

export interface SandboxSessionStream {
  readonly streamId: number;
  readonly state: SandboxSessionStreamState;
  onEvent(listener: (event: SandboxSessionStreamEvent) => void): () => void;
  sendControl(message: SandboxSessionOutboundControlMessageInput): Promise<void>;
  sendDataFrame(input: { payload: Uint8Array; payloadKind: number }): Promise<void>;
  dispose(): void;
}

type TransportListener = (event: SandboxSessionTransportEvent) => void;
type StreamListener = (event: SandboxSessionStreamEvent) => void;

type PendingOpen = {
  streamId: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutTask: SandboxScheduledTask;
};

type ActiveStreamRecord = {
  sendWindowBytes: number;
  stream: SandboxSessionTransportStream;
};

function getInitialSendWindowBytes(channel: StreamChannel): number {
  return channel.kind === "agent" ? MaxStreamWindowBytes : DefaultStreamWindowBytes;
}

function readMessageEventPayload(event: unknown): unknown {
  if (typeof event === "object" && event !== null && "data" in event) {
    return event.data;
  }

  return event;
}

function readTextPayload(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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

function normalizeSocketCloseEvent(event: unknown): {
  code: number;
  reason: string;
  wasClean: boolean;
} {
  if (typeof event === "number") {
    return {
      code: event,
      reason: "",
      wasClean: false,
    };
  }

  if (typeof event !== "object" || event === null) {
    return {
      code: 1006,
      reason: "",
      wasClean: false,
    };
  }

  const code = "code" in event && typeof event.code === "number" ? event.code : 1006;
  const reason = "reason" in event && typeof event.reason === "string" ? event.reason : "";
  const wasClean =
    "wasClean" in event && typeof event.wasClean === "boolean" ? event.wasClean : false;

  return {
    code,
    reason,
    wasClean,
  };
}

function createStreamResetError(
  message: Extract<StreamControlMessage, { type: "stream.reset" }>,
): Error {
  return new Error(`Sandbox session stream reset (${message.code}): ${message.message}`);
}

function createStreamCompleteError(streamId: number): Error {
  return new Error(`Sandbox session stream ${String(streamId)} completed.`);
}

function withStreamId(input: {
  message: SandboxSessionOutboundControlMessageInput;
  streamId: number;
}): SandboxSessionOutboundControlMessage {
  switch (input.message.type) {
    case "stream.close":
      return {
        type: "stream.close",
        streamId: input.streamId,
      };
    case "stream.signal":
      return {
        type: "stream.signal",
        streamId: input.streamId,
        signal: input.message.signal,
      };
    case "stream.window":
      return {
        type: "stream.window",
        streamId: input.streamId,
        bytes: input.message.bytes,
      };
  }
}

class SandboxSessionTransportStream implements SandboxSessionStream {
  readonly #listeners = new Set<StreamListener>();
  readonly #transport: SandboxSessionTransport;
  #isDisposed = false;
  #queuedEvents: SandboxSessionStreamEvent[] = [];
  #state: SandboxSessionStreamState;

  constructor(input: {
    streamId: number;
    transport: SandboxSessionTransport;
    initialState: SandboxSessionStreamState;
  }) {
    this.streamId = input.streamId;
    this.#transport = input.transport;
    this.#state = input.initialState;
  }

  readonly streamId: number;

  get state(): SandboxSessionStreamState {
    return this.#state;
  }

  onEvent(listener: StreamListener): () => void {
    if (this.#isDisposed) {
      throw new Error(`Sandbox session stream ${String(this.streamId)} has been disposed.`);
    }

    this.#listeners.add(listener);
    if (this.#queuedEvents.length > 0) {
      const queuedEvents = [...this.#queuedEvents];
      this.#queuedEvents = [];
      for (const queuedEvent of queuedEvents) {
        listener(queuedEvent);
      }
    }
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async sendControl(message: SandboxSessionOutboundControlMessageInput): Promise<void> {
    await this.#transport.sendControlForStream({
      streamId: this.streamId,
      message: withStreamId({
        message,
        streamId: this.streamId,
      }),
    });
  }

  async sendDataFrame(input: { payload: Uint8Array; payloadKind: number }): Promise<void> {
    await this.#transport.sendDataFrameForStream({
      streamId: this.streamId,
      payload: input.payload,
      payloadKind: input.payloadKind,
    });
  }

  dispose(): void {
    this.#isDisposed = true;
    this.#listeners.clear();
    this.#queuedEvents = [];
  }

  markOpen(): void {
    this.#setState("open", null);
  }

  markClosed(errorMessage: string | null): void {
    this.#setState("closed", errorMessage);
  }

  markReset(resetMessage: Extract<StreamControlMessage, { type: "stream.reset" }>): void {
    this.#setState("reset", createStreamResetError(resetMessage).message);
  }

  markTransportClosed(errorMessage: string): void {
    this.#setState("transport_closed", errorMessage);
  }

  emitControl(message: StreamControlMessage): void {
    this.#emit({
      type: "control",
      message,
    });
  }

  emitData(frame: StreamDataFrame): void {
    this.#emit({
      type: "data",
      frame,
    });
  }

  #emit(event: SandboxSessionStreamEvent): void {
    if (this.#isDisposed) {
      return;
    }

    if (this.#listeners.size === 0) {
      this.#queuedEvents.push(event);
      return;
    }

    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  #setState(state: SandboxSessionStreamState, errorMessage: string | null): void {
    this.#state = state;
    this.#emit({
      type: "state_changed",
      state,
      errorMessage,
    });
  }
}

export class SandboxSessionTransport {
  readonly #connectTimeoutMs: number;
  readonly #listeners = new Set<TransportListener>();
  readonly #pendingOpensByStreamId = new Map<number, PendingOpen>();
  readonly #runtime: SandboxSessionRuntime;
  readonly #activeStreamsByStreamId = new Map<number, ActiveStreamRecord>();

  #errorMessage: string | null = null;
  #socket: SandboxSessionSocket | null = null;

  constructor(input: SandboxSessionTransportInput) {
    this.#runtime = input.runtime;
    this.#connectTimeoutMs = input.connectTimeoutMs ?? DefaultConnectTimeoutMs;
  }

  get readyState(): number {
    return this.#socket?.readyState ?? SandboxSessionSocketReadyStates.CLOSED;
  }

  get errorMessage(): string | null {
    return this.#errorMessage;
  }

  get socket(): SandboxSessionSocket | null {
    return this.#socket;
  }

  get sendGuarantee(): SandboxSessionSendGuarantee | null {
    return this.#socket?.sendGuarantee ?? null;
  }

  onEvent(listener: TransportListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async connect(input: { connectionUrl: string }): Promise<void> {
    const existingSocket = this.#socket;
    if (
      existingSocket !== null &&
      existingSocket.readyState !== SandboxSessionSocketReadyStates.CLOSED
    ) {
      throw new Error("Sandbox session transport already has an active websocket.");
    }

    this.#errorMessage = null;

    const socket = this.#runtime.createSocket(input.connectionUrl);
    this.#socket = socket;
    this.#attachSocketListeners(socket);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeoutTask = this.#runtime.scheduleTimeout(() => {
        finishWithFailure(new Error("Sandbox websocket connection timed out."));
      }, this.#connectTimeoutMs);

      const cleanup = (): void => {
        timeoutTask.cancel();
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
      };

      const finishWithFailure = (error: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        this.#detachSocketListeners(socket);
        this.#socket = null;
        this.#errorMessage = error.message;
        socket.close();
        reject(error);
      };

      const handleOpen = (): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve();
      };

      const handleError = (): void => {
        finishWithFailure(new Error("Sandbox websocket connection failed."));
      };

      const handleClose = (): void => {
        finishWithFailure(new Error("Sandbox websocket connection closed before it opened."));
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
    });
  }

  disconnect(closeCode?: number, reason?: string): void {
    const socket = this.#socket;
    this.#socket = null;
    this.#rejectPendingOpens(new Error("Sandbox websocket connection closed."));
    this.#markAllStreamsTransportClosed("Sandbox websocket connection closed.");
    if (socket === null) {
      return;
    }

    this.#detachSocketListeners(socket);
    socket.close(closeCode, reason);
  }

  async openStream(input: { channel: StreamChannel }): Promise<SandboxSessionStream> {
    const socket = this.#socket;
    if (socket === null || socket.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox session transport is not connected.");
    }

    const streamId = this.#runtime.createStreamId();
    const stream = new SandboxSessionTransportStream({
      streamId,
      transport: this,
      initialState: "opening",
    });
    this.#activeStreamsByStreamId.set(streamId, {
      sendWindowBytes: getInitialSendWindowBytes(input.channel),
      stream,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timeoutTask = this.#runtime.scheduleTimeout(() => {
          this.#pendingOpensByStreamId.delete(streamId);
          reject(
            new Error(
              `Timed out waiting for stream.open acknowledgement for stream ${String(streamId)}.`,
            ),
          );
        }, this.#connectTimeoutMs);

        this.#pendingOpensByStreamId.set(streamId, {
          streamId,
          resolve: (): void => {
            timeoutTask.cancel();
            resolve();
          },
          reject: (error): void => {
            timeoutTask.cancel();
            reject(error);
          },
          timeoutTask,
        });

        const openMessage: StreamOpen = {
          type: "stream.open",
          streamId,
          channel: input.channel,
        };
        void socket.send(JSON.stringify(openMessage)).catch((error) => {
          const pendingOpen = this.#pendingOpensByStreamId.get(streamId);
          if (pendingOpen === undefined) {
            return;
          }

          this.#pendingOpensByStreamId.delete(streamId);
          pendingOpen.reject(
            error instanceof Error ? error : new Error("Failed to send stream.open request."),
          );
        });
      });
      stream.markOpen();
    } catch (error) {
      this.#activeStreamsByStreamId.delete(streamId);
      stream.dispose();
      throw error;
    }

    return stream;
  }

  async sendTextMessage(payload: string): Promise<void> {
    const socket = this.#socket;
    if (socket === null || socket.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox session transport is not connected.");
    }

    await socket.send(payload);
  }

  async sendControlForStream(input: {
    streamId: number;
    message: SandboxSessionOutboundControlMessage;
  }): Promise<void> {
    const socket = this.#socket;
    const streamRecord = this.#activeStreamsByStreamId.get(input.streamId);
    if (socket === null || socket.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox session transport is not connected.");
    }
    if (streamRecord === undefined || streamRecord.stream.state !== "open") {
      throw new Error(`Sandbox session stream ${String(input.streamId)} is not open.`);
    }

    await socket.send(JSON.stringify(input.message));
  }

  async sendDataFrameForStream(input: {
    streamId: number;
    payload: Uint8Array;
    payloadKind: number;
  }): Promise<void> {
    const socket = this.#socket;
    const streamRecord = this.#activeStreamsByStreamId.get(input.streamId);
    if (socket === null || socket.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox session transport is not connected.");
    }
    if (streamRecord === undefined || streamRecord.stream.state !== "open") {
      throw new Error(`Sandbox session stream ${String(input.streamId)} is not open.`);
    }
    if (
      input.payloadKind !== PayloadKindRawBytes &&
      input.payloadKind !== PayloadKindWebSocketText &&
      input.payloadKind !== PayloadKindWebSocketBinary
    ) {
      throw new Error(
        `Sandbox session payload kind '${String(input.payloadKind)}' is not supported.`,
      );
    }
    if (input.payload.byteLength > streamRecord.sendWindowBytes) {
      throw new Error("Sandbox session stream send window is exhausted.");
    }

    streamRecord.sendWindowBytes -= input.payload.byteLength;
    await socket.send(
      encodeDataFrame({
        streamId: input.streamId,
        payloadKind: input.payloadKind,
        payload: input.payload,
      }),
    );
  }

  #emit(event: SandboxSessionTransportEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
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
    const messagePayload = readMessageEventPayload(event);
    const textPayload = readTextPayload(messagePayload);
    if (textPayload !== null) {
      const streamControlMessage = parseStreamControlMessage(textPayload);
      if (streamControlMessage !== undefined) {
        this.#handleControlMessage(streamControlMessage);
        return;
      }

      const portsControlMessage = parsePortsControlMessage(textPayload);
      if (portsControlMessage !== undefined) {
        this.#emit({
          type: "unhandled_control",
          message: portsControlMessage,
        });
        return;
      }

      const bootstrapControlMessage = parseBootstrapControlMessage(textPayload);
      if (bootstrapControlMessage !== undefined) {
        this.#emit({
          type: "unhandled_control",
          message: bootstrapControlMessage,
        });
        return;
      }

      if (streamControlMessage === undefined) {
        this.#closeTransportWithError(
          "Sandbox websocket text payload was not a valid control message.",
        );
      }
      return;
    }

    const binaryPayload = readBinaryPayload(messagePayload);
    if (binaryPayload === null) {
      this.#closeTransportWithError("Sandbox websocket message payload type is not supported.");
      return;
    }

    let dataFrame: StreamDataFrame;
    try {
      dataFrame = decodeDataFrame(toUint8Array(binaryPayload));
    } catch (error) {
      this.#closeTransportWithError(
        error instanceof Error
          ? error.message
          : "Sandbox websocket binary payload was not a valid data frame.",
      );
      return;
    }

    const streamRecord = this.#activeStreamsByStreamId.get(dataFrame.streamId);
    if (streamRecord === undefined) {
      this.#emit({
        type: "unhandled_data",
        frame: dataFrame,
      });
      return;
    }

    this.#sendReceiveWindowUpdate({
      bytes: dataFrame.payload.byteLength,
      streamId: dataFrame.streamId,
    });
    streamRecord.stream.emitData(dataFrame);
  };

  #handleControlMessage(controlMessage: StreamControlMessage): void {
    if (controlMessage.type === "stream.open.ok" || controlMessage.type === "stream.open.error") {
      this.#handleOpenResult(controlMessage);
      return;
    }

    const streamRecord = this.#activeStreamsByStreamId.get(controlMessage.streamId);
    if (streamRecord === undefined) {
      this.#emit({
        type: "unhandled_control",
        message: controlMessage,
      });
      return;
    }

    if (controlMessage.type === "stream.window") {
      const nextSendWindowBytes = streamRecord.sendWindowBytes + controlMessage.bytes;
      if (nextSendWindowBytes > MaxStreamWindowBytes) {
        this.#closeTransportWithError(
          `Sandbox session stream send window exceeds the configured maximum of ${String(MaxStreamWindowBytes)} bytes.`,
        );
        return;
      }

      streamRecord.sendWindowBytes = nextSendWindowBytes;
      streamRecord.stream.emitControl(controlMessage);
      return;
    }

    if (controlMessage.type === "stream.reset") {
      this.#activeStreamsByStreamId.delete(controlMessage.streamId);
      streamRecord.stream.emitControl(controlMessage);
      streamRecord.stream.markReset(controlMessage);
      return;
    }

    if (controlMessage.type === "stream.complete") {
      this.#activeStreamsByStreamId.delete(controlMessage.streamId);
      streamRecord.stream.emitControl(controlMessage);
      streamRecord.stream.markClosed(createStreamCompleteError(controlMessage.streamId).message);
      return;
    }

    streamRecord.stream.emitControl(controlMessage);
  }

  #handleOpenResult(controlMessage: StreamOpenOK | StreamOpenError): void {
    const pendingOpen = this.#pendingOpensByStreamId.get(controlMessage.streamId);
    if (pendingOpen === undefined) {
      this.#emit({
        type: "unhandled_control",
        message: controlMessage,
      });
      return;
    }

    this.#pendingOpensByStreamId.delete(controlMessage.streamId);
    if (controlMessage.type === "stream.open.error") {
      const streamRecord = this.#activeStreamsByStreamId.get(controlMessage.streamId);
      if (streamRecord !== undefined) {
        this.#activeStreamsByStreamId.delete(controlMessage.streamId);
        streamRecord.stream.markClosed(controlMessage.message);
      }
      pendingOpen.reject(new SandboxSessionStreamOpenError(controlMessage));
      return;
    }

    pendingOpen.resolve();
  }

  readonly #handleSocketClose = (event: unknown): void => {
    this.#socket = null;
    const closeEvent = normalizeSocketCloseEvent(event);
    const message =
      closeEvent.reason.length > 0 ? closeEvent.reason : "Sandbox websocket connection closed.";
    this.#errorMessage = message;
    this.#rejectPendingOpens(new Error(message));
    this.#markAllStreamsTransportClosed(message);
    this.#emit({
      type: "close",
      code: closeEvent.code,
      reason: closeEvent.reason,
      wasClean: closeEvent.wasClean,
    });
  };

  readonly #handleSocketError = (): void => {
    const error = new Error("Sandbox websocket connection failed.");
    this.#errorMessage = error.message;
    this.#rejectPendingOpens(error);
    this.#markAllStreamsTransportClosed(error.message);
    this.#emit({
      type: "error",
      error,
    });
  };

  #closeTransportWithError(message: string): void {
    const socket = this.#socket;
    this.#socket = null;
    this.#errorMessage = message;
    this.#rejectPendingOpens(new Error(message));
    this.#markAllStreamsTransportClosed(message);
    if (socket !== null) {
      this.#detachSocketListeners(socket);
      socket.close(ProtocolViolationCloseCode, message);
    }
    this.#emit({
      type: "error",
      error: new Error(message),
    });
  }

  #rejectPendingOpens(error: Error): void {
    for (const pendingOpen of this.#pendingOpensByStreamId.values()) {
      pendingOpen.timeoutTask.cancel();
      pendingOpen.reject(error);
    }
    this.#pendingOpensByStreamId.clear();
  }

  #markAllStreamsTransportClosed(message: string): void {
    for (const streamRecord of this.#activeStreamsByStreamId.values()) {
      streamRecord.stream.markTransportClosed(message);
    }
    this.#activeStreamsByStreamId.clear();
  }

  #sendReceiveWindowUpdate(input: { bytes: number; streamId: number }): void {
    const socket = this.#socket;
    if (
      socket === null ||
      socket.readyState !== SandboxSessionSocketReadyStates.OPEN ||
      input.bytes <= 0
    ) {
      return;
    }

    void socket
      .send(
        JSON.stringify({
          type: "stream.window",
          streamId: input.streamId,
          bytes: input.bytes,
        }),
      )
      .catch(() => {
        this.#closeTransportWithError(
          "Failed to send sandbox session stream.window acknowledgement.",
        );
      });
  }
}
