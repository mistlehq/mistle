import type { StreamOpen } from "@mistle/sandbox-session-protocol";

import { startNativePtySession } from "../native/pty-host.js";
import { AsyncQueue } from "./async-queue.js";

type NativePtySession = ReturnType<typeof startNativePtySession>;

export class PtySessionOutputClosedError extends Error {
  constructor() {
    super("pty output is closed");
  }
}

export class PtySession {
  readonly #session: NativePtySession;
  readonly #output = new AsyncQueue<Uint8Array>();
  readonly #exitPromise: Promise<number>;
  readonly #resolveExit: (exitCode: number) => void;
  #exitCode = 0;
  #exited = false;

  constructor(input: {
    session: NativePtySession;
    exitPromise: Promise<number>;
    resolveExit: (exitCode: number) => void;
  }) {
    this.#session = input.session;
    this.#exitPromise = input.exitPromise;
    this.#resolveExit = input.resolveExit;
  }

  #handleExit(exitCode: number): void {
    if (this.#exited) {
      return;
    }

    this.#exited = true;
    this.#exitCode = exitCode;
    this.#resolveExit(exitCode);
  }

  #handleError(message: string): void {
    this.#output.fail(new Error(message));
  }

  #handleClosed(): void {
    this.#output.fail(new PtySessionOutputClosedError());
  }

  #handleOutput(data: Uint8Array): void {
    this.#output.push(new Uint8Array(data));
  }

  static create(input: { cwd?: string; cols?: number; rows?: number }): PtySession {
    let resolveExit: (exitCode: number) => void = () => undefined;
    let session: PtySession | undefined;
    const pendingEvents: Array<
      | { type: "output"; data: Uint8Array }
      | { type: "exit"; exitCode: number }
      | { type: "closed" }
      | { type: "error"; message: string }
    > = [];

    function applyPendingEvent(
      activeSession: PtySession,
      event:
        | { type: "output"; data: Uint8Array }
        | { type: "exit"; exitCode: number }
        | { type: "closed" }
        | { type: "error"; message: string },
    ): void {
      switch (event.type) {
        case "output":
          activeSession.#handleOutput(event.data);
          return;
        case "exit":
          activeSession.#handleExit(event.exitCode);
          return;
        case "closed":
          activeSession.#handleClosed();
          return;
        case "error":
          activeSession.#handleError(event.message);
      }
    }

    function bufferOrApplyEvent(
      event:
        | { type: "output"; data: Uint8Array }
        | { type: "exit"; exitCode: number }
        | { type: "closed" }
        | { type: "error"; message: string },
    ): void {
      if (session === undefined) {
        pendingEvents.push(event);
        return;
      }

      applyPendingEvent(session, event);
    }

    const nativeSession = startNativePtySession(input, {
      onEvent(event) {
        switch (event.kind) {
          case "output": {
            const data = event.data;
            if (data === undefined) {
              throw new Error("pty output event data is required");
            }
            bufferOrApplyEvent({
              type: "output",
              data: new Uint8Array(data),
            });
            return;
          }
          case "exit": {
            const exitCode = event.exitCode;
            if (exitCode === undefined) {
              throw new Error("pty exit event exitCode is required");
            }
            bufferOrApplyEvent({
              type: "exit",
              exitCode,
            });
            return;
          }
          case "closed":
            bufferOrApplyEvent({
              type: "closed",
            });
            return;
          case "error": {
            const message = event.message;
            if (message === undefined) {
              throw new Error("pty error event message is required");
            }
            bufferOrApplyEvent({
              type: "error",
              message,
            });
            return;
          }
          default:
            throw new Error(`unsupported pty event kind '${event.kind}'`);
        }
      },
    });

    const exitPromise = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });

    session = new PtySession({
      session: nativeSession,
      exitPromise,
      resolveExit,
    });

    for (const event of pendingEvents) {
      applyPendingEvent(session, event);
    }

    return session;
  }

  isExited(): boolean {
    return this.#exited;
  }

  exitCode(): number {
    return this.#exitCode;
  }

  resize(cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
      throw new Error("pty resize cols and rows must be between 1 and 65535");
    }
    if (cols > 65_535 || rows > 65_535) {
      throw new Error("pty resize cols and rows must be between 1 and 65535");
    }
    if (this.#exited) {
      throw new Error("pty session has already exited");
    }

    this.#session.resize(cols, rows);
  }

  write(payload: Uint8Array): void {
    if (this.#exited) {
      return;
    }

    this.#session.write(Buffer.from(payload));
  }

  nextOutput(signal: AbortSignal): Promise<Uint8Array> {
    return this.#output.next(signal);
  }

  waitForExit(): Promise<number> {
    return this.#exitPromise;
  }

  async terminate(): Promise<number> {
    const exitCode = await this.#session.terminate();
    this.#handleExit(exitCode);
    return exitCode;
  }
}

export function startPtySession(connectRequest: StreamOpen): PtySession {
  const channel = connectRequest.channel;
  if (channel.kind !== "pty") {
    throw new Error("pty stream.open request channel.kind must be 'pty'");
  }

  return PtySession.create({
    ...(channel.cwd === undefined ? {} : { cwd: channel.cwd }),
    ...(channel.cols === undefined ? {} : { cols: channel.cols }),
    ...(channel.rows === undefined ? {} : { rows: channel.rows }),
  });
}
