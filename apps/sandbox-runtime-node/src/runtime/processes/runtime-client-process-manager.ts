import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createConnection as createNetConnection } from "node:net";

import type {
  RuntimeClientProcessReadiness,
  RuntimeClientProcessSpec,
} from "@mistle/integrations-core";

type RunningRuntimeClientProcess = {
  spec: RuntimeClientProcessSpec;
  child: ChildProcess;
  exited: Promise<void>;
  hasExited: () => boolean;
  exitError: () => Error | undefined;
};

export type RuntimeClientProcessExit = {
  processKey: string;
  err?: Error;
};

export type RuntimeClientProcessManager = {
  stop: () => Promise<void>;
  unexpectedExit: Promise<RuntimeClientProcessExit>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function exitErrorFromChild(code: number | null, signal: NodeJS.Signals | null): Error | undefined {
  if (signal !== null) {
    return new Error(`process exited with signal ${signal}`);
  }

  if (code === null || code === 0) {
    return undefined;
  }

  return new Error(`process exited with code ${code}`);
}

function stopSignal(signal: "sigterm" | "sigkill"): NodeJS.Signals {
  switch (signal) {
    case "sigterm":
      return "SIGTERM";
    case "sigkill":
      return "SIGKILL";
  }
}

function mergeProcessEnvironment(
  overrides: Record<string, string> | undefined,
): NodeJS.ProcessEnv | undefined {
  if (overrides === undefined) {
    return undefined;
  }

  return {
    ...process.env,
    ...overrides,
  };
}

async function startRuntimeClientProcess(
  processSpec: RuntimeClientProcessSpec,
): Promise<RunningRuntimeClientProcess> {
  if (processSpec.command.args.length === 0) {
    throw new Error("process command args must not be empty");
  }

  const [command, ...args] = processSpec.command.args;
  if (command === undefined) {
    throw new Error("process command args must not be empty");
  }

  const child = spawn(command, args, {
    cwd:
      processSpec.command.cwd !== undefined && processSpec.command.cwd.trim().length > 0
        ? processSpec.command.cwd
        : undefined,
    env: mergeProcessEnvironment(processSpec.command.env),
    stdio: "inherit",
  });

  let exited = false;
  let exitErr: Error | undefined;

  const exitedPromise = new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      exited = true;
      exitErr = exitErrorFromChild(code, signal);
      resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const handleSpawn = (): void => {
      child.off("error", handleError);
      resolve();
    };

    const handleError = (error: Error): void => {
      child.off("spawn", handleSpawn);
      reject(error);
    };

    child.once("spawn", handleSpawn);
    child.once("error", handleError);
  }).catch((error: unknown) => {
    throw new Error(`failed to start process command: ${errorMessage(error)}`);
  });

  return {
    spec: processSpec,
    child,
    exited: exitedPromise,
    hasExited: () => exited,
    exitError: () => exitErr,
  };
}

function waitForRuntimeClientProcessExit(
  process: RunningRuntimeClientProcess,
  waitDurationMs: number,
): Promise<void> {
  if (waitDurationMs <= 0) {
    return process.hasExited()
      ? Promise.resolve()
      : Promise.reject(new Error("process exit wait timed out"));
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("process exit wait timed out"));
    }, waitDurationMs);

    void process.exited.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function signalRuntimeClientProcess(
  process: RunningRuntimeClientProcess,
  signal: NodeJS.Signals,
): Promise<void> {
  if (process.hasExited()) {
    return;
  }

  if (process.child.pid === undefined) {
    throw new Error("runtime client process has no running OS process");
  }

  try {
    const signaled = process.child.kill(signal);
    if (!signaled && !process.hasExited()) {
      throw new Error("failed to signal process");
    }
  } catch (error) {
    if (process.hasExited()) {
      return;
    }

    throw new Error(`failed to signal process: ${errorMessage(error)}`);
  }
}

async function stopRuntimeClientProcess(process: RunningRuntimeClientProcess): Promise<void> {
  if (process.hasExited()) {
    return;
  }

  const deadlineAt = Date.now() + process.spec.stop.timeoutMs;
  await signalRuntimeClientProcess(process, stopSignal(process.spec.stop.signal));

  if (process.spec.stop.signal === "sigterm" && (process.spec.stop.gracePeriodMs ?? 0) > 0) {
    try {
      await waitForRuntimeClientProcessExit(process, process.spec.stop.gracePeriodMs ?? 0);
      return;
    } catch {
      await signalRuntimeClientProcess(process, "SIGKILL");
    }
  }

  const remainingDurationMs = deadlineAt - Date.now();
  if (remainingDurationMs <= 0) {
    throw new Error("stop policy timeout exceeded before process exit");
  }

  try {
    await waitForRuntimeClientProcessExit(process, remainingDurationMs);
  } catch (error) {
    throw new Error(`process did not exit before stop timeout: ${errorMessage(error)}`);
  }
}

function readinessProbeRequest(
  readinessUrl: string,
  expectedUpgrade?: "websocket",
): Promise<number> {
  const requestUrl = new URL(readinessUrl);
  if (requestUrl.protocol === "ws:") {
    requestUrl.protocol = "http:";
  } else if (requestUrl.protocol === "wss:") {
    requestUrl.protocol = "https:";
  }

  const requestFn = requestUrl.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<number>((resolve, reject) => {
    const request = requestFn(
      requestUrl,
      {
        method: "GET",
        headers:
          expectedUpgrade === undefined
            ? undefined
            : {
                Connection: "Upgrade",
                Upgrade: expectedUpgrade,
                "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
                "Sec-WebSocket-Version": "13",
              },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        response.resume();
        resolve(statusCode);
      },
    );

    request.setTimeout(500, () => {
      request.destroy(new Error("request timed out"));
    });

    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      resolve(101);
    });

    request.once("error", reject);
    request.end();
  });
}

function checkTCPReadiness(
  readiness: Extract<RuntimeClientProcessReadiness, { type: "tcp" }>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = createNetConnection({
      host: readiness.host,
      port: readiness.port,
    });

    socket.setTimeout(250, () => {
      socket.destroy(new Error("connection timed out"));
    });

    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });

    socket.once("error", reject);
  });
}

async function checkHTTPReadiness(
  readiness: Extract<RuntimeClientProcessReadiness, { type: "http" }>,
): Promise<void> {
  const statusCode = await readinessProbeRequest(readiness.url);
  if (statusCode !== readiness.expectedStatus) {
    throw new Error(
      `http readiness returned status ${statusCode}, expected ${readiness.expectedStatus}`,
    );
  }
}

async function checkWSReadiness(
  readiness: Extract<RuntimeClientProcessReadiness, { type: "ws" }>,
): Promise<void> {
  const statusCode = await readinessProbeRequest(readiness.url, "websocket");
  if (statusCode !== 101) {
    throw new Error(`websocket readiness returned status ${statusCode}, expected 101`);
  }
}

async function waitForRuntimeClientProcessCheck(
  process: RunningRuntimeClientProcess,
  timeoutMs: number,
  check: () => Promise<void>,
): Promise<void> {
  const deadlineAt = Date.now() + timeoutMs;
  let lastErr: Error | undefined;

  while (true) {
    if (process.hasExited()) {
      const processErr = process.exitError();
      throw new Error(
        processErr === undefined
          ? "process exited before readiness"
          : `process exited before readiness: ${processErr.message}`,
      );
    }

    try {
      await check();
      return;
    } catch (error) {
      lastErr = error instanceof Error ? error : new Error(String(error));
    }

    const remainingDurationMs = deadlineAt - Date.now();
    if (remainingDurationMs <= 0) {
      break;
    }

    const pollWaitMs = Math.min(100, remainingDurationMs);
    await Promise.race([
      process.exited,
      new Promise<void>((resolve) => {
        setTimeout(resolve, pollWaitMs);
      }),
    ]);
  }

  throw new Error(
    lastErr === undefined
      ? `timed out after ${timeoutMs}ms waiting for readiness`
      : `timed out after ${timeoutMs}ms waiting for readiness: ${lastErr.message}`,
  );
}

async function waitForRuntimeClientProcessReadiness(
  process: RunningRuntimeClientProcess,
  readiness: RuntimeClientProcessReadiness,
): Promise<void> {
  switch (readiness.type) {
    case "none":
      return;
    case "tcp":
      await waitForRuntimeClientProcessCheck(process, readiness.timeoutMs, async () => {
        await checkTCPReadiness(readiness);
      });
      return;
    case "http":
      await waitForRuntimeClientProcessCheck(process, readiness.timeoutMs, async () => {
        await checkHTTPReadiness(readiness);
      });
      return;
    case "ws":
      await waitForRuntimeClientProcessCheck(process, readiness.timeoutMs, async () => {
        await checkWSReadiness(readiness);
      });
      return;
  }
}

export async function startRuntimeClientProcessManager(
  processes: ReadonlyArray<RuntimeClientProcessSpec>,
): Promise<RuntimeClientProcessManager> {
  const startedProcesses: RunningRuntimeClientProcess[] = [];
  let stopRequested = false;
  let unexpectedExitResolved = false;
  let resolveUnexpectedExit!: (value: RuntimeClientProcessExit) => void;
  const unexpectedExit = new Promise<RuntimeClientProcessExit>((resolve) => {
    resolveUnexpectedExit = resolve;
  });

  async function stop(): Promise<void> {
    stopRequested = true;

    const stopErrors: string[] = [];
    for (let processIndex = startedProcesses.length - 1; processIndex >= 0; processIndex -= 1) {
      const process = startedProcesses[processIndex];
      if (process === undefined) {
        continue;
      }

      try {
        await stopRuntimeClientProcess(process);
      } catch (error) {
        stopErrors.push(`processKey=${process.spec.processKey}: ${errorMessage(error)}`);
      }
    }

    if (stopErrors.length > 0) {
      throw new Error(`failed to stop runtime client processes: ${stopErrors.join("; ")}`);
    }
  }

  function watchForUnexpectedProcessExit(process: RunningRuntimeClientProcess): void {
    void process.exited.then(() => {
      if (stopRequested || unexpectedExitResolved) {
        return;
      }

      unexpectedExitResolved = true;
      resolveUnexpectedExit({
        processKey: process.spec.processKey,
        err: process.exitError() ?? new Error("process exited"),
      });
    });
  }

  for (const [processIndex, processSpec] of processes.entries()) {
    let process: RunningRuntimeClientProcess | undefined;
    try {
      process = await startRuntimeClientProcess(processSpec);
      startedProcesses.push(process);
      watchForUnexpectedProcessExit(process);
      await waitForRuntimeClientProcessReadiness(process, processSpec.readiness);
    } catch (error) {
      try {
        await stop();
      } catch {
        // Preserve the primary startup failure.
      }

      if (process === undefined) {
        throw new Error(
          `runtime client process[${processIndex}] failed to start (processKey=${processSpec.processKey}): ${errorMessage(error)}`,
        );
      }

      throw new Error(
        `runtime client process[${processIndex}] readiness check failed (processKey=${processSpec.processKey}): ${errorMessage(error)}`,
      );
    }
  }

  return {
    stop,
    unexpectedExit,
  };
}
