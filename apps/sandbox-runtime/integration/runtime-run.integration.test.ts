import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

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

describe("runRuntime", () => {
  it("fails when runtime client process startup fails", async () => {
    const startupInputJson = `{
      "bootstrapToken": "test-token",
      "tunnelExchangeToken": "test-exchange-token",
      "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox",
      "instanceVolume": {
        "mode": "native",
        "state": "new"
      },
      "runtimePlan": {
        "sandboxProfileId": "sbp_test",
        "version": 1,
        "image": {
          "source": "base",
          "imageRef": "mistle/sandbox-base:dev"
        },
        "egressRoutes": [],
        "artifacts": [],
        "runtimeClients": [
          {
            "clientId": "client_codex",
            "setup": {
              "env": {},
              "files": []
            },
            "processes": [
              {
                "processKey": "process_codex_server",
                "command": {
                  "args": ["/definitely/missing/binary"],
                  "env": {}
                },
                "readiness": {
                  "type": "none"
                },
                "stop": {
                  "signal": "sigterm",
                  "timeoutMs": 1000,
                  "gracePeriodMs": 100
                }
              }
            ],
            "endpoints": []
          }
        ],
        "workspaceSources": [],
        "agentRuntimes": []
      }
    }`;

    await expect(
      runRuntime({
        lookupEnv: createLookupEnv(),
        stdin: Readable.from([startupInputJson]),
      }),
    ).rejects.toThrow("failed to start runtime client processes");
  });

  it("fails when a runtime client process exits unexpectedly", async () => {
    const startupInputJson = `{
      "bootstrapToken": "test-token",
      "tunnelExchangeToken": "test-exchange-token",
      "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox",
      "instanceVolume": {
        "mode": "native",
        "state": "new"
      },
      "runtimePlan": {
        "sandboxProfileId": "sbp_test",
        "version": 1,
        "image": {
          "source": "base",
          "imageRef": "mistle/sandbox-base:dev"
        },
        "egressRoutes": [],
        "artifacts": [],
        "runtimeClients": [
          {
            "clientId": "client_codex",
            "setup": {
              "env": {},
              "files": []
            },
            "processes": [
              {
                "processKey": "process_exit_later",
                "command": {
                  "args": ["${process.execPath}", "${RuntimeClientProcessHelperPath}"],
                  "env": {
                    "SANDBOX_RUNTIME_PROCESS_HELPER_MODE": "exit-after-delay",
                    "SANDBOX_RUNTIME_PROCESS_HELPER_DELAY_MS": "100"
                  }
                },
                "readiness": {
                  "type": "none"
                },
                "stop": {
                  "signal": "sigterm",
                  "timeoutMs": 1000
                }
              }
            ],
            "endpoints": []
          }
        ],
        "workspaceSources": [],
        "agentRuntimes": []
      }
    }`;

    await expect(
      runRuntime({
        lookupEnv: createLookupEnv(),
        stdin: Readable.from([startupInputJson]),
      }),
    ).rejects.toThrow("runtime client process 'process_exit_later' exited unexpectedly");
  });
});
