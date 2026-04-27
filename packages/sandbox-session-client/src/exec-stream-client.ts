import { type ExecResultEvent } from "@mistle/sandbox-session-protocol";
import { systemScheduler } from "@mistle/time";

import { SandboxSessionSocketReadyStates } from "./runtime.js";
import { type SandboxSessionStream, type SandboxSessionTransport } from "./transport.js";

const DefaultExecIdleTimeoutMs = 60_000;

export type ExecStreamClientInput = {
  idleTimeoutMs?: number;
  transport: SandboxSessionTransport;
};

export type ExecCommandRequest = {
  command: string;
  args?: string[];
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type ExecCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

function normalizeExecResult(event: ExecResultEvent): ExecCommandResult {
  return {
    exitCode: event.exitCode,
    stdout: event.stdout,
    stderr: event.stderr,
    truncated: event.truncated,
  };
}

function isExecResultEvent(message: unknown): message is {
  type: "stream.event";
  event: ExecResultEvent;
} {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const messageType = Reflect.get(message, "type");
  if (messageType !== "stream.event") {
    return false;
  }

  const event = Reflect.get(message, "event");
  if (typeof event !== "object" || event === null) {
    return false;
  }

  return Reflect.get(event, "type") === "exec.result";
}

const ExecTimeoutRuntime = {
  scheduleTimeout(callback: () => void, delayMs: number): { cancel: () => void } {
    const handle = systemScheduler.schedule(callback, delayMs);
    return {
      cancel: () => {
        systemScheduler.cancel(handle);
      },
    };
  },
};

async function waitForExecCompletion(input: {
  idleTimeoutMs: number;
  runtime: typeof ExecTimeoutRuntime;
  stream: SandboxSessionStream;
}): Promise<ExecCommandResult> {
  return await new Promise((resolve, reject) => {
    let latestResult: ExecCommandResult | null = null;
    let unsubscribe = (): void => {};
    const timeoutTask = input.runtime.scheduleTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for exec stream result."));
    }, input.idleTimeoutMs);

    const settle = (callback: () => void): void => {
      timeoutTask.cancel();
      unsubscribe();
      callback();
    };

    unsubscribe = input.stream.onEvent((event) => {
      if (event.type === "control" && isExecResultEvent(event.message)) {
        latestResult = normalizeExecResult(event.message.event);
        return;
      }

      if (event.type !== "state_changed") {
        return;
      }

      if (event.state === "closed") {
        settle(() => {
          if (latestResult === null) {
            reject(new Error("Exec stream completed before delivering a result."));
            return;
          }

          resolve(latestResult);
        });
        return;
      }

      if (event.state === "reset" || event.state === "transport_closed") {
        settle(() => {
          reject(new Error(event.errorMessage ?? "Exec stream ended unexpectedly."));
        });
      }
    });
  });
}

export class ExecStreamClient {
  readonly #idleTimeoutMs: number;
  readonly #transport: SandboxSessionTransport;

  constructor(input: ExecStreamClientInput) {
    this.#transport = input.transport;
    this.#idleTimeoutMs = input.idleTimeoutMs ?? DefaultExecIdleTimeoutMs;
  }

  async run(input: ExecCommandRequest): Promise<ExecCommandResult> {
    if (this.#transport.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox session socket is not open.");
    }

    const stream = await this.#transport.openStream({
      channel: {
        kind: "exec",
        command: input.command,
        ...(input.args === undefined ? {} : { args: input.args }),
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }),
      },
    });

    try {
      return await waitForExecCompletion({
        idleTimeoutMs: this.#idleTimeoutMs,
        runtime: ExecTimeoutRuntime,
        stream,
      });
    } finally {
      stream.dispose();
    }
  }
}

export { DefaultExecIdleTimeoutMs };
