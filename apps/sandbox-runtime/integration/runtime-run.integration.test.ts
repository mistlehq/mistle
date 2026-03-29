import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { ListenAddrEnv, TokenizerProxyEgressBaseUrlEnv } from "../src/runtime/config.js";
import { runRuntime } from "../src/runtime/run.js";

const RuntimeClientProcessHelperPath = fileURLToPath(
  new URL("./helpers/runtime-client-process-helper.mjs", import.meta.url),
);

function createLookupEnv(): (key: string) => string | undefined {
  return (key) => {
    switch (key) {
      case ListenAddrEnv:
        return ":0";
      case TokenizerProxyEgressBaseUrlEnv:
        return "http://127.0.0.1:8091/tokenizer-proxy/egress";
      default:
        return undefined;
    }
  };
}

function createStartupInputJson(input: {
  startupMode: "new" | "existing";
  runtimePlan: CompiledRuntimePlan;
}): string {
  return JSON.stringify({
    startupMode: input.startupMode,
    bootstrapToken: "test-token",
    tunnelExchangeToken: "test-exchange-token",
    tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
    runtimePlan: input.runtimePlan,
    egressGrantByRuleId: {},
  });
}

describe("runRuntime", () => {
  it("fails when runtime client process startup fails", async () => {
    const startupInputJson = createStartupInputJson({
      startupMode: "new",
      runtimePlan: {
        sandboxProfileId: "sbp_test",
        version: 1,
        image: {
          source: "base",
          imageRef: "mistle/sandbox-base:dev",
        },
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [
          {
            clientId: "client_codex",
            setup: {
              env: {},
              files: [],
            },
            processes: [
              {
                processKey: "process_codex_server",
                command: {
                  args: ["/definitely/missing/binary"],
                  env: {},
                },
                readiness: {
                  type: "none",
                },
                stop: {
                  signal: "sigterm",
                  timeoutMs: 1000,
                  gracePeriodMs: 100,
                },
              },
            ],
            endpoints: [],
          },
        ],
        workspaceSources: [],
        agentRuntimes: [],
      },
    });

    await expect(
      runRuntime({
        lookupEnv: createLookupEnv(),
        stdin: Readable.from([startupInputJson]),
      }),
    ).rejects.toThrow("failed to start runtime client processes");
  });

  it("fails when a runtime client process exits unexpectedly", async () => {
    const startupInputJson = createStartupInputJson({
      startupMode: "existing",
      runtimePlan: {
        sandboxProfileId: "sbp_test",
        version: 1,
        image: {
          source: "base",
          imageRef: "mistle/sandbox-base:dev",
        },
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [
          {
            clientId: "client_codex",
            setup: {
              env: {},
              files: [],
            },
            processes: [
              {
                processKey: "process_exit_later",
                command: {
                  args: [process.execPath, RuntimeClientProcessHelperPath],
                  env: {
                    SANDBOX_RUNTIME_PROCESS_HELPER_MODE: "exit-after-delay",
                    SANDBOX_RUNTIME_PROCESS_HELPER_DELAY_MS: "100",
                  },
                },
                readiness: {
                  type: "none",
                },
                stop: {
                  signal: "sigterm",
                  timeoutMs: 1000,
                },
              },
            ],
            endpoints: [],
          },
        ],
        workspaceSources: [],
        agentRuntimes: [],
      },
    });

    await expect(
      runRuntime({
        lookupEnv: createLookupEnv(),
        stdin: Readable.from([startupInputJson]),
      }),
    ).rejects.toThrow("runtime client process 'process_exit_later' exited unexpectedly");
  });

  it("skips runtime plan mutation for existing sandboxes and still proceeds to process startup", async () => {
    const startupInputJson = createStartupInputJson({
      startupMode: "existing",
      runtimePlan: {
        sandboxProfileId: "sbp_test",
        version: 1,
        image: {
          source: "base",
          imageRef: "mistle/sandbox-base:dev",
        },
        egressRoutes: [],
        artifacts: [
          {
            artifactKey: "artifact_should_not_install",
            name: "artifact_should_not_install",
            lifecycle: {
              install: [
                {
                  args: ["sh", "-c", "echo should-not-run >&2; exit 91"],
                },
              ],
              remove: [],
            },
          },
        ],
        runtimeClients: [
          {
            clientId: "client_codex",
            setup: {
              env: {},
              files: [
                {
                  fileId: "file_should_not_write",
                  path: "/definitely/blocked/path/config.toml",
                  mode: 0o600,
                  content: 'value = "x"',
                },
              ],
            },
            processes: [
              {
                processKey: "process_codex_server",
                command: {
                  args: ["/definitely/missing/binary"],
                  env: {},
                },
                readiness: {
                  type: "none",
                },
                stop: {
                  signal: "sigterm",
                  timeoutMs: 1000,
                  gracePeriodMs: 100,
                },
              },
            ],
            endpoints: [],
          },
        ],
        workspaceSources: [
          {
            sourceKind: "git-clone",
            resourceKind: "repository",
            path: "/definitely/blocked/path/repo",
            originUrl: "https://example.com/repo.git",
          },
        ],
        agentRuntimes: [],
      },
    });

    await expect(
      runRuntime({
        lookupEnv: createLookupEnv(),
        stdin: Readable.from([startupInputJson]),
      }),
    ).rejects.toThrow("failed to start runtime client processes");
  });
});
