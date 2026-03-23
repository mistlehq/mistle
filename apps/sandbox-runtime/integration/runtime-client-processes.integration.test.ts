import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CompiledRuntimeClient, RuntimeClientProcessSpec } from "@mistle/integrations-core";
import { afterEach, describe, expect, it } from "vitest";

import { startRuntimeClientProcessManager } from "../src/runtime/processes/runtime-client-process-manager.js";
import { flattenRuntimeClientProcesses } from "../src/runtime/processes/runtime-client-processes.js";
import {
  applyEnvironmentEntries,
  resolveBaselineProxyEnvironment,
} from "../src/runtime/proxy/proxy-environment.js";

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

function helperChildPidPath(): string {
  return join(tmpdir(), `mistle-runtime-client-child-${process.pid}-${randomUUID()}`);
}

function sleepForPollInterval(delayMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

async function waitForChildPid(path: string): Promise<number> {
  const deadlineAt = Date.now() + 2_000;

  while (Date.now() < deadlineAt) {
    try {
      const value = await readFile(path, "utf8");
      const pid = Number.parseInt(value.trim(), 10);
      if (Number.isInteger(pid) && pid > 0) {
        return pid;
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }

    sleepForPollInterval(10);
  }

  throw new Error("expected helper child pid to be written");
}

async function expectProcessAbsent(pid: number): Promise<void> {
  const deadlineAt = Date.now() + 2_000;

  while (Date.now() < deadlineAt) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        return;
      }

      throw error;
    }

    sleepForPollInterval(10);
  }

  throw new Error(`expected process ${pid} to be absent`);
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

  it("preserves unexpected non-TERM/KILL signal names", async () => {
    const manager = await startRuntimeClientProcessManager([
      {
        ...helperProcessSpec("process_abort", "abort-immediately", {}),
      },
    ]);
    StartedManagers.add(manager);

    const processExit = await manager.unexpectedExit;
    expect(processExit.processKey).toBe("process_abort");
    expect(processExit.err?.message).toContain("SIGABRT");
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

  it("kills the full process tree when stop escalates to sigkill", async () => {
    const childPidPath = helperChildPidPath();
    const manager = await startRuntimeClientProcessManager([
      {
        ...helperProcessSpec("process_ignore_sigterm_tree", "ignore-sigterm-with-child", {
          SANDBOX_RUNTIME_PROCESS_HELPER_CHILD_PID_PATH: childPidPath,
        }),
        stop: {
          signal: "sigterm",
          timeoutMs: 1_500,
          gracePeriodMs: 100,
        },
      },
    ]);
    StartedManagers.add(manager);

    try {
      const childPid = await waitForChildPid(childPidPath);
      await expect(manager.stop()).resolves.toBeUndefined();
      StartedManagers.delete(manager);
      await expectProcessAbsent(childPid);
    } finally {
      await rm(childPidPath, { force: true });
    }
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
      allProxy: undefined,
      allProxyLower: undefined,
      httpsProxy: undefined,
      httpsProxyLower: undefined,
      httpProxy: undefined,
      httpProxyLower: undefined,
      noProxy: undefined,
      noProxyLower: undefined,
      setupValue: "setup-value",
      overriddenValue: "process",
      processOnlyValue: "process-only",
      wsProxy: undefined,
      wsProxyLower: undefined,
      wssProxy: undefined,
      wssProxyLower: undefined,
    });
  });

  it("propagates baseline proxy env to spawned runtime clients", async () => {
    const restoreEnvironment = applyEnvironmentEntries(
      resolveBaselineProxyEnvironment({
        listenAddr: ":8090",
        tokenizerProxyEgressBaseUrl: "http://tokenizer-proxy.internal:8081/tokenizer-proxy/egress",
      }),
    );

    const freePort = await reserveTCPPort();

    try {
      const manager = await startRuntimeClientProcessManager([
        {
          ...helperProcessSpec("process_proxy_env", "http-listen", {
            SANDBOX_RUNTIME_PROCESS_HELPER_PORT: String(freePort),
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
      ]);
      StartedManagers.add(manager);

      const response = await fetch(`http://127.0.0.1:${freePort}/env`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        allProxy: "http://127.0.0.1:8090",
        allProxyLower: "http://127.0.0.1:8090",
        httpsProxy: "http://127.0.0.1:8090",
        httpsProxyLower: "http://127.0.0.1:8090",
        httpProxy: "http://127.0.0.1:8090",
        httpProxyLower: "http://127.0.0.1:8090",
        noProxy: "127.0.0.1,::1,localhost,tokenizer-proxy.internal,tokenizer-proxy.internal:8081",
        noProxyLower:
          "127.0.0.1,::1,localhost,tokenizer-proxy.internal,tokenizer-proxy.internal:8081",
        setupValue: undefined,
        overriddenValue: undefined,
        processOnlyValue: undefined,
        wsProxy: "http://127.0.0.1:8090",
        wsProxyLower: "http://127.0.0.1:8090",
        wssProxy: "http://127.0.0.1:8090",
        wssProxyLower: "http://127.0.0.1:8090",
      });
    } finally {
      restoreEnvironment();
    }
  });
});
