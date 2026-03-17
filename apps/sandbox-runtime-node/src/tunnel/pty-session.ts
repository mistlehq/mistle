import type { StreamOpen } from "@mistle/sandbox-session-protocol";
import { spawn, type IPty } from "node-pty";

import { AsyncQueue } from "./async-queue.js";

const PTY_TERMINATE_TIMEOUT_MS = 2_000;
const PTY_FORCE_KILL_TIMEOUT_MS = 2_000;
const DEFAULT_PTY_SHELL = "/bin/sh";
const PREFERRED_TERM = "xterm-256color";

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export class PtySession {
  readonly #process: IPty;
  readonly #output = new AsyncQueue<Uint8Array>();
  readonly #exitPromise: Promise<number>;
  #exitCode = 0;
  #exited = false;

  constructor(process: IPty) {
    this.#process = process;
    this.#exitPromise = new Promise<number>((resolve) => {
      process.onData((data) => {
        this.#output.push(new TextEncoder().encode(data));
      });
      process.onExit((event) => {
        this.#exited = true;
        this.#exitCode = event.exitCode;
        resolve(event.exitCode);
      });
    });
  }

  get pid(): number {
    return this.#process.pid;
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

    this.#process.resize(cols, rows);
  }

  write(payload: Uint8Array): void {
    if (this.#exited) {
      return;
    }

    this.#process.write(Buffer.from(payload));
  }

  nextOutput(signal: AbortSignal): Promise<Uint8Array> {
    return this.#output.next(signal);
  }

  async waitForExit(): Promise<number> {
    return this.#exitPromise;
  }

  async terminate(): Promise<number> {
    if (this.#exited) {
      return this.#exitCode;
    }

    this.#process.kill("SIGTERM");
    const gracefulExit = await Promise.race([
      this.#exitPromise.then((exitCode) => ({
        type: "exit" as const,
        exitCode,
      })),
      sleep(PTY_TERMINATE_TIMEOUT_MS).then(() => ({
        type: "timeout" as const,
      })),
    ]);
    if (gracefulExit.type === "exit") {
      return gracefulExit.exitCode;
    }

    this.#process.kill("SIGKILL");
    const forcedExit = await Promise.race([
      this.#exitPromise.then((exitCode) => ({
        type: "exit" as const,
        exitCode,
      })),
      sleep(PTY_FORCE_KILL_TIMEOUT_MS).then(() => ({
        type: "timeout" as const,
      })),
    ]);
    if (forcedExit.type === "exit") {
      return forcedExit.exitCode;
    }

    throw new Error("pty process did not exit after termination signals");
  }
}

export function startPtySession(connectRequest: StreamOpen): PtySession {
  const channel = connectRequest.channel;
  if (channel.kind !== "pty") {
    throw new Error("pty stream.open request channel.kind must be 'pty'");
  }

  const ptyProcess = spawn(DEFAULT_PTY_SHELL, ["-i"], {
    ...(channel.cwd === undefined ? {} : { cwd: channel.cwd }),
    env: {
      ...process.env,
      TERM: PREFERRED_TERM,
    },
    ...(channel.cols === undefined ? {} : { cols: channel.cols }),
    ...(channel.rows === undefined ? {} : { rows: channel.rows }),
  });

  return new PtySession(ptyProcess);
}
