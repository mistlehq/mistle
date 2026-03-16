import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import type { CompiledRuntimeClient, RuntimeClientProcessSpec } from "@mistle/integrations-core";
import { afterEach, describe, expect, it } from "vitest";

import { startRuntimeClientProcessManager } from "../src/runtime/processes/runtime-client-process-manager.js";
import { flattenRuntimeClientProcesses } from "../src/runtime/processes/runtime-client-processes.js";

const RuntimeClientProcessHelperPath = fileURLToPath(
  new URL("./helpers/runtime-client-process-helper.mjs", import.meta.url),
);

const StartedManagers = new Set<Awaited<ReturnType<typeof startRuntimeClientProcessManager>>>();

async function reserveTCPPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP address");
  }

  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

function helperProcessSpec(
  processKey: string,
  mode: string,
  env: Record<string, string>,
): RuntimeClientProcessSpec {
  return {
    processKey,
    command: {
      args: [process.execPath, RuntimeClientProcessHelperPath],
      env: {
        SANDBOX_RUNTIME_PROCESS_HELPER_MODE: mode,
        ...env,
      },
    },
    readiness: {
      type: "none",
    },
    stop: {
      signal: "sigterm",
      timeoutMs: 1000,
    },
  };
}

afterEach(async () => {
  for (const manager of StartedManagers) {
    await manager.stop();
  }

  StartedManagers.clear();
});

describe("startRuntimeClientProcessManager", () => {
  it("starts process and waits for tcp readiness", async () => {
    const freePort = await reserveTCPPort();
    const manager = await startRuntimeClientProcessManager([
      {
        ...helperProcessSpec("process_codex", "tcp-listen", {
          SANDBOX_RUNTIME_PROCESS_HELPER_PORT: String(freePort),
        }),
        readiness: {
          type: "tcp",
          host: "127.0.0.1",
          port: freePort,
          timeoutMs: 2000,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: 2000,
          gracePeriodMs: 100,
        },
      },
    ]);

    StartedManagers.add(manager);
    expect(manager.unexpectedExit).toBeInstanceOf(Promise);
  });

  it("starts process and waits for http readiness", async () => {
    const freePort = await reserveTCPPort();
    const manager = await startRuntimeClientProcessManager([
      {
        ...helperProcessSpec("process_http", "http-listen", {
          SANDBOX_RUNTIME_PROCESS_HELPER_PORT: String(freePort),
          SANDBOX_RUNTIME_PROCESS_HELPER_STATUS_CODE: "204",
        }),
        readiness: {
          type: "http",
          url: `http://127.0.0.1:${freePort}`,
          expectedStatus: 204,
          timeoutMs: 2000,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: 2000,
          gracePeriodMs: 100,
        },
      },
    ]);

    StartedManagers.add(manager);
    expect(manager.unexpectedExit).toBeInstanceOf(Promise);
  });

  it("fails startup when process exits before readiness is reached", async () => {
    await expect(
      startRuntimeClientProcessManager([
        {
          ...helperProcessSpec("process_exit_early", "exit-immediately", {}),
          readiness: {
            type: "tcp",
            host: "127.0.0.1",
            port: 65535,
            timeoutMs: 1000,
          },
        },
      ]),
    ).rejects.toThrow("process exited before readiness");
  });

  it("starts process and waits for ws readiness", async () => {
    const freePort = await reserveTCPPort();
    const manager = await startRuntimeClientProcessManager([
      {
        ...helperProcessSpec("process_codex_ws", "ws-listen", {
          SANDBOX_RUNTIME_PROCESS_HELPER_PORT: String(freePort),
        }),
        readiness: {
          type: "ws",
          url: `ws://127.0.0.1:${freePort}`,
          timeoutMs: 2000,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: 2000,
          gracePeriodMs: 100,
        },
      },
    ]);

    StartedManagers.add(manager);
    expect(manager.unexpectedExit).toBeInstanceOf(Promise);
  });

  it("starts process and waits for ws readiness when server skips close handshake", async () => {
    const freePort = await reserveTCPPort();
    const manager = await startRuntimeClientProcessManager([
      {
        ...helperProcessSpec("process_codex_ws_close_now", "ws-listen-close-now", {
          SANDBOX_RUNTIME_PROCESS_HELPER_PORT: String(freePort),
        }),
        readiness: {
          type: "ws",
          url: `ws://127.0.0.1:${freePort}`,
          timeoutMs: 2000,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: 2000,
          gracePeriodMs: 100,
        },
      },
    ]);

    StartedManagers.add(manager);
    expect(manager.unexpectedExit).toBeInstanceOf(Promise);
  });

  it("reports unexpected process exits", async () => {
    const manager = await startRuntimeClientProcessManager([
      {
        ...helperProcessSpec("process_exit_later", "exit-after-delay", {
          SANDBOX_RUNTIME_PROCESS_HELPER_DELAY_MS: "100",
        }),
        stop: {
          signal: "sigterm",
          timeoutMs: 1000,
        },
      },
    ]);
    StartedManagers.add(manager);

    const processExit = await manager.unexpectedExit;
    expect(processExit.processKey).toBe("process_exit_later");
    expect(processExit.err).toBeInstanceOf(Error);
  });

  it("escalates sigterm to sigkill after grace period when process ignores sigterm", async () => {
    const manager = await startRuntimeClientProcessManager([
      {
        ...helperProcessSpec("process_ignore_sigterm", "ignore-sigterm", {}),
        stop: {
          signal: "sigterm",
          timeoutMs: 1500,
          gracePeriodMs: 100,
        },
      },
    ]);

    await expect(manager.stop()).resolves.toBeUndefined();
  });

  it("starts processes with merged runtime client setup env", async () => {
    const freePort = await reserveTCPPort();
    const runtimeClients: CompiledRuntimeClient[] = [
      {
        clientId: "client_env",
        setup: {
          env: {
            SETUP_VALUE: "setup-value",
            OVERRIDDEN_VALUE: "setup",
          },
          files: [],
        },
        processes: [
          {
            ...helperProcessSpec("process_env", "http-listen", {
              SANDBOX_RUNTIME_PROCESS_HELPER_PORT: String(freePort),
              PROCESS_ONLY_VALUE: "process-only",
              OVERRIDDEN_VALUE: "process",
            }),
            readiness: {
              type: "http",
              url: `http://127.0.0.1:${freePort}`,
              expectedStatus: 200,
              timeoutMs: 2000,
            },
            stop: {
              signal: "sigterm",
              timeoutMs: 2000,
              gracePeriodMs: 100,
            },
          },
        ],
        endpoints: [],
      },
    ];

    const manager = await startRuntimeClientProcessManager(
      flattenRuntimeClientProcesses(runtimeClients),
    );
    StartedManagers.add(manager);

    const response = await fetch(`http://127.0.0.1:${freePort}/env`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      setupValue: "setup-value",
      overriddenValue: "process",
      processOnlyValue: "process-only",
    });
  });
});
