import { once } from "node:events";
import { createServer, type Server } from "node:http";

import {
  startRuntimeClientProcessManager,
  type RuntimeClientProcessExit,
  type RuntimeClientProcessManager,
} from "../processes/runtime-client-process-manager.js";
import { flattenRuntimeClientProcesses } from "../processes/runtime-client-processes.js";
import { applyRuntimePlan } from "../runtime-plan/index.js";
import { loadRuntimeConfig, type RuntimeConfig } from "./config.js";
import {
  readStartupInput,
  DefaultStartupInputMaxBytes,
  type StartupInput,
} from "./read-startup-input.js";
import { createRouter } from "./router.js";

type LookupEnv = (key: string) => string | undefined;

export type RunRuntimeInput = {
  lookupEnv: LookupEnv;
  stdin: NodeJS.ReadableStream;
};

export type StartedRuntime = {
  config: RuntimeConfig;
  startupInput: StartupInput;
  server: Server;
  baseUrl: string;
  unexpectedProcessExit: Promise<RuntimeClientProcessExit>;
  close: () => Promise<void>;
  closed: Promise<void>;
};

function parseListenAddress(listenAddr: string): { host?: string; port: number } {
  if (listenAddr.startsWith(":")) {
    const port = Number.parseInt(listenAddr.slice(1), 10);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error(`invalid listen addr ${listenAddr}`);
    }

    return {
      port,
    };
  }

  const separatorIndex = listenAddr.lastIndexOf(":");
  if (separatorIndex < 1 || separatorIndex === listenAddr.length - 1) {
    throw new Error(`invalid listen addr ${listenAddr}`);
  }

  const host = listenAddr.slice(0, separatorIndex);
  const port = Number.parseInt(listenAddr.slice(separatorIndex + 1), 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`invalid listen addr ${listenAddr}`);
  }

  return {
    host,
    port,
  };
}

function getBaseUrl(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("runtime server address is unavailable");
  }

  const host = address.address === "::" ? "127.0.0.1" : address.address;
  return `http://${host}:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function startRuntime(input: RunRuntimeInput): Promise<StartedRuntime> {
  if (input.lookupEnv === undefined) {
    throw new Error("lookup env function is required");
  }

  if (input.stdin === undefined || input.stdin === null) {
    throw new Error("stdin reader is required");
  }

  const config = loadRuntimeConfig(input.lookupEnv);
  const startupInput = await readStartupInput({
    reader: input.stdin,
    maxBytes: DefaultStartupInputMaxBytes,
  });
  const state = {
    startupReady: false,
  };

  const listenAddress = parseListenAddress(config.listenAddr);
  const server = createServer(
    createRouter({
      state,
    }),
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenAddress.port, listenAddress.host, () => {
      server.off("error", reject);
      resolve();
    });
  }).catch((error: unknown) => {
    throw new Error(
      `failed to bind listen addr ${config.listenAddr}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  let processManager: RuntimeClientProcessManager | undefined;
  try {
    await applyRuntimePlan({
      runtimePlan: startupInput.runtimePlan,
    });
    processManager = await startRuntimeClientProcessManager(
      flattenRuntimeClientProcesses(startupInput.runtimePlan.runtimeClients),
    );
    state.startupReady = true;
  } catch (error) {
    await closeServer(server);

    throw new Error(
      error instanceof Error && error.message.startsWith("runtime client process[")
        ? `failed to start runtime client processes: ${error.message}`
        : `failed to apply runtime plan: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const closed = once(server, "close").then(() => undefined);
  const unexpectedProcessExit =
    processManager?.unexpectedExit ??
    new Promise<RuntimeClientProcessExit>(() => {
      // Intentionally pending when there are no runtime client processes.
    });

  return {
    config,
    startupInput,
    server,
    baseUrl: getBaseUrl(server),
    unexpectedProcessExit,
    close: async () => {
      await closeServer(server);

      if (processManager !== undefined) {
        await processManager.stop();
      }
    },
    closed,
  };
}

export async function runRuntime(input: RunRuntimeInput): Promise<never> {
  const runtime = await startRuntime(input);
  const result = await Promise.race([
    runtime.closed.then(() => ({
      type: "closed" as const,
    })),
    runtime.unexpectedProcessExit.then((processExit) => ({
      type: "process-exit" as const,
      processExit,
    })),
  ]);

  if (result.type === "closed") {
    throw new Error("sandbox runtime server closed unexpectedly");
  }

  try {
    await runtime.close();
  } catch {
    // Preserve the primary unexpected-exit error.
  }
  if (result.processExit.err !== undefined) {
    throw new Error(
      `runtime client process '${result.processExit.processKey}' exited unexpectedly: ${result.processExit.err.message}`,
    );
  }

  throw new Error(`runtime client process '${result.processExit.processKey}' exited unexpectedly`);
}
