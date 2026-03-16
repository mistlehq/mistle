import { once } from "node:events";
import { createServer, type Server } from "node:http";

import { applyRuntimePlan } from "../runtime-plan/index.js";
import { createRouter } from "../server/router.js";
import {
  readStartupInput,
  DefaultStartupInputMaxBytes,
  type StartupInput,
} from "../startup/read-startup-input.js";
import { loadRuntimeConfig, type RuntimeConfig } from "./config.js";

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

  const listenAddress = parseListenAddress(config.listenAddr);
  const server = createServer(
    createRouter({
      bootstrapTokenLoaded: startupInput.bootstrapToken.length > 0,
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

  try {
    await applyRuntimePlan({
      runtimePlan: startupInput.runtimePlan,
    });
  } catch (error) {
    await new Promise<void>((resolve, reject) => {
      server.close((closeError) => {
        if (closeError !== undefined) {
          reject(closeError);
          return;
        }
        resolve();
      });
    });

    throw new Error(
      `failed to apply runtime plan: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const closed = once(server, "close").then(() => undefined);

  return {
    config,
    startupInput,
    server,
    baseUrl: getBaseUrl(server),
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    closed,
  };
}

export async function runRuntime(input: RunRuntimeInput): Promise<never> {
  const runtime = await startRuntime(input);
  await runtime.closed;
  throw new Error("sandbox runtime server closed unexpectedly");
}
