import {
  PayloadKindRawBytes,
  type StreamControlMessage,
  type StreamSignalMessage,
} from "@mistle/sandbox-session-protocol";
import { systemScheduler, type TimerHandle } from "@mistle/time";

import {
  SandboxPtyStates,
  type PtyStreamClientInput,
  type SandboxPtyExitInfo,
  type SandboxPtyOpenOptions,
  type SandboxPtyResetInfo,
  type SandboxPtyState,
} from "./pty-types.js";
import { SandboxSessionSocketReadyStates } from "./runtime.js";
import type {
  SandboxSessionStream,
  SandboxSessionStreamEvent,
  SandboxSessionTransportEvent,
} from "./transport.js";

const DefaultCloseTimeoutMs = 500;
const TextEncoderInstance = new TextEncoder();

type PendingClose = {
  reject: (error: Error) => void;
  resolve: () => void;
  timeoutId: TimerHandle;
};

function createPtyStreamOpenChannel(options: SandboxPtyOpenOptions): {
  args?: string[];
  cols: number;
  command?: string;
  cwd?: string;
  kind: "pty";
  ptySessionId: string;
  rows: number;
  session: "create";
} {
  const args = options.args?.filter((value) => value.trim().length > 0);

  return {
    kind: "pty",
    session: "create",
    ptySessionId: options.ptySessionId.trim(),
    cols: options.cols,
    rows: options.rows,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.command === undefined ? {} : { command: options.command }),
    ...(args === undefined || args.length === 0 ? {} : { args }),
  };
}

function createPtyResizeMessage(input: { cols: number; rows: number }): {
  signal: Extract<StreamSignalMessage, { type: "stream.signal" }>["signal"];
  type: "stream.signal";
} {
  return {
    type: "stream.signal",
    signal: {
      type: "pty.resize",
      cols: input.cols,
      rows: input.rows,
    },
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

export class PtyStreamClient {
  readonly #closeTimeoutMs: number;
  readonly #dataListeners = new Set<(chunk: Uint8Array) => void>();
  readonly #errorListeners = new Set<(error: Error) => void>();
  readonly #exitListeners = new Set<(info: SandboxPtyExitInfo) => void>();
  readonly #resetListeners = new Set<(info: SandboxPtyResetInfo) => void>();
  readonly #stateListeners = new Set<(state: SandboxPtyState) => void>();
  readonly #transport: PtyStreamClientInput["transport"];
  readonly #unsubscribeTransportEvent: () => void;

  #error: Error | null = null;
  #exitInfo: SandboxPtyExitInfo | null = null;
  #pendingClose: PendingClose | null = null;
  #resetInfo: SandboxPtyResetInfo | null = null;
  #state: SandboxPtyState = SandboxPtyStates.IDLE;
  #stream: SandboxSessionStream | null = null;
  #unsubscribeStreamEvent: (() => void) | null = null;

  constructor(input: PtyStreamClientInput) {
    this.#transport = input.transport;
    this.#closeTimeoutMs = input.closeTimeoutMs ?? DefaultCloseTimeoutMs;
    this.#unsubscribeTransportEvent = this.#transport.onEvent((event) => {
      this.#handleTransportEvent(event);
    });
  }

  get state(): SandboxPtyState {
    return this.#state;
  }

  get streamId(): number | null {
    return this.#stream?.streamId ?? null;
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
    if (this.#state !== SandboxPtyStates.IDLE) {
      throw new Error("Sandbox PTY client can only connect from the idle state.");
    }
    if (this.#transport.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox PTY websocket is not open.");
    }

    this.#setState(SandboxPtyStates.CONNECTED);
  }

  async open(options: SandboxPtyOpenOptions): Promise<void> {
    if (options.ptySessionId.trim().length === 0) {
      throw new Error("Sandbox PTY session id is required.");
    }
    assertValidPtyDimensions(options, "open");
    if (this.#state !== SandboxPtyStates.CONNECTED) {
      throw new Error("Sandbox PTY stream can only open from the connected state.");
    }
    if (this.#transport.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox PTY websocket is not open.");
    }

    this.#setState(SandboxPtyStates.OPENING);
    this.#error = null;
    this.#exitInfo = null;
    this.#resetInfo = null;

    try {
      const stream = await this.#transport.openStream({
        channel: createPtyStreamOpenChannel(options),
      });
      this.#attachStream(stream);
      this.#setState(SandboxPtyStates.OPEN);
    } catch (error) {
      const resolvedError =
        error instanceof Error ? error : new Error("Could not open sandbox PTY session.");
      this.#error = resolvedError;
      if (this.#transport.readyState === SandboxSessionSocketReadyStates.OPEN) {
        this.#setState(SandboxPtyStates.CONNECTED);
      } else {
        this.#setErrorState(resolvedError);
      }
      throw resolvedError;
    }
  }

  async write(data: Uint8Array | string): Promise<void> {
    const stream = this.#stream;
    if (this.#state !== SandboxPtyStates.OPEN || stream === null || stream.state !== "open") {
      throw new Error("Sandbox PTY stream is not open.");
    }

    await stream.sendDataFrame({
      payloadKind: PayloadKindRawBytes,
      payload: typeof data === "string" ? TextEncoderInstance.encode(data) : data,
    });
  }

  async resize(input: { cols: number; rows: number }): Promise<void> {
    assertValidPtyDimensions(input, "resize");
    const stream = this.#stream;
    if (this.#state !== SandboxPtyStates.OPEN || stream === null || stream.state !== "open") {
      throw new Error("Sandbox PTY stream is not open.");
    }

    await stream.sendControl(createPtyResizeMessage(input));
  }

  async close(): Promise<void> {
    const stream = this.#stream;
    if (this.#state !== SandboxPtyStates.OPEN || stream === null || stream.state !== "open") {
      throw new Error("Sandbox PTY stream is not open.");
    }

    this.#setState(SandboxPtyStates.CLOSING);

    await new Promise<void>((resolve, reject) => {
      const timeoutId = systemScheduler.schedule(() => {
        if (this.#pendingClose?.timeoutId !== timeoutId) {
          return;
        }
        this.#pendingClose = null;
        reject(new Error("Timed out while waiting for sandbox PTY close confirmation."));
      }, this.#closeTimeoutMs);

      this.#pendingClose = {
        resolve: () => {
          systemScheduler.cancel(timeoutId);
          this.#pendingClose = null;
          resolve();
        },
        reject: (error) => {
          systemScheduler.cancel(timeoutId);
          this.#pendingClose = null;
          reject(error);
        },
        timeoutId,
      };

      void stream.sendControl({ type: "stream.close" }).catch((error: unknown) => {
        const resolvedError =
          error instanceof Error ? error : new Error("Failed to send sandbox PTY stream.close.");
        this.#pendingClose?.reject(resolvedError);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.#state === SandboxPtyStates.OPEN) {
      try {
        await this.close();
      } catch {
        // Preserve explicit disconnect semantics even if the remote PTY close fails.
      }
    } else if (this.#state === SandboxPtyStates.CLOSING && this.#pendingClose !== null) {
      try {
        await new Promise<void>((resolve, reject) => {
          const pendingClose = this.#pendingClose;
          if (pendingClose === null) {
            resolve();
            return;
          }
          const originalResolve = pendingClose.resolve;
          const originalReject = pendingClose.reject;
          pendingClose.resolve = () => {
            originalResolve();
            resolve();
          };
          pendingClose.reject = (error) => {
            originalReject(error);
            reject(error);
          };
        });
      } catch {
        // Disconnect remains best-effort once close is already in flight.
      }
    }

    this.#rejectPendingClose(new Error("Sandbox PTY client disconnected."));
    this.#detachStream();
    this.#unsubscribeTransportEvent();
    this.#setState(SandboxPtyStates.CLOSED);
  }

  #attachStream(stream: SandboxSessionStream): void {
    this.#stream = stream;
    this.#unsubscribeStreamEvent = stream.onEvent((event) => {
      this.#handleStreamEvent(stream, event);
    });
  }

  #detachStream(): void {
    this.#unsubscribeStreamEvent?.();
    this.#unsubscribeStreamEvent = null;
    this.#stream?.dispose();
    this.#stream = null;
  }

  #handleTransportEvent(event: SandboxSessionTransportEvent): void {
    if (
      this.#state === SandboxPtyStates.IDLE ||
      this.#state === SandboxPtyStates.CLOSED ||
      this.#state === SandboxPtyStates.ERROR
    ) {
      return;
    }

    if (event.type === "close") {
      this.#rejectPendingClose(new Error("Sandbox PTY websocket connection closed."));
      this.#detachStream();
      this.#setState(SandboxPtyStates.CLOSED);
      return;
    }

    if (event.type === "error") {
      this.#rejectPendingClose(event.error);
      this.#detachStream();
      this.#setErrorState(event.error);
    }
  }

  #handleStreamEvent(stream: SandboxSessionStream, event: SandboxSessionStreamEvent): void {
    if (this.#stream !== stream) {
      return;
    }

    if (event.type === "state_changed") {
      if (event.state === "closed") {
        this.#detachStream();
        if (this.#pendingClose !== null) {
          this.#pendingClose.resolve();
        }
        if (this.#transport.readyState === SandboxSessionSocketReadyStates.OPEN) {
          this.#setState(SandboxPtyStates.CONNECTED);
        } else {
          this.#setState(SandboxPtyStates.CLOSED);
        }
        return;
      }

      if (event.state === "reset") {
        const resetInfo = this.#resetInfo;
        this.#detachStream();
        if (resetInfo !== null) {
          const resetError = createStreamResetError(resetInfo);
          this.#error = resetError;
          this.#pendingClose?.reject(resetError);
          if (this.#transport.readyState === SandboxSessionSocketReadyStates.OPEN) {
            this.#setState(SandboxPtyStates.CONNECTED);
          } else {
            this.#setErrorState(resetError);
          }
        }
        return;
      }

      if (event.state === "transport_closed") {
        this.#rejectPendingClose(
          new Error(event.errorMessage ?? "Sandbox PTY websocket connection closed."),
        );
        this.#detachStream();
        this.#setState(SandboxPtyStates.CLOSED);
      }
      return;
    }

    if (event.type === "control") {
      this.#handleControlMessage(event.message);
      return;
    }

    if (event.frame.payloadKind !== PayloadKindRawBytes) {
      this.#setErrorState(
        new Error("Sandbox PTY stream received an unsupported data payload kind."),
      );
      return;
    }

    for (const listener of this.#dataListeners) {
      listener(event.frame.payload);
    }
  }

  #handleControlMessage(message: StreamControlMessage): void {
    if (message.type === "stream.event" && message.event.type === "pty.exit") {
      this.#exitInfo = {
        exitCode: message.event.exitCode,
      };
      for (const listener of this.#exitListeners) {
        listener(this.#exitInfo);
      }

      if (this.#pendingClose !== null) {
        this.#pendingClose.resolve();
      } else if (this.#transport.readyState === SandboxSessionSocketReadyStates.OPEN) {
        this.#detachStream();
        this.#setState(SandboxPtyStates.CONNECTED);
      }
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
    }
  }

  #rejectPendingClose(error: Error): void {
    const pendingClose = this.#pendingClose;
    if (pendingClose === null) {
      return;
    }

    pendingClose.reject(error);
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
}
