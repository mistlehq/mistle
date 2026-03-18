import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { ListenAddrEnv, TokenizerProxyEgressBaseUrlEnv } from "../src/runtime/config.js";
import { startRuntime } from "../src/runtime/run.js";

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

function createStartupInputJson(tunnelGatewayWsUrl: string): string {
  return `{
    "bootstrapToken": "test-token",
    "tunnelExchangeToken": "test-exchange-token",
    "tunnelGatewayWsUrl": "${tunnelGatewayWsUrl}",
    "instanceVolume": {
      "mode": "native",
      "state": "new"
    },
    "runtimePlan": {
      "sandboxProfileId": "sbp_123",
      "version": 1,
      "image": {
        "source": "base",
        "imageRef": "mistle/sandbox-base:dev"
      },
      "egressRoutes": [],
      "artifacts": [],
      "runtimeClients": [],
      "workspaceSources": [],
      "agentRuntimes": []
    }
  }`;
}

describe("startRuntime tunnel lifecycle", () => {
  it("fails fast when the tunnel gateway url is invalid", async () => {
    await expect(
      startRuntime({
        lookupEnv: createLookupEnv(),
        stdin: Readable.from([createStartupInputJson("http://127.0.0.1:5003/tunnel/sandbox")]),
      }),
    ).rejects.toThrow(
      "failed to start sandbox tunnel: sandbox tunnel gateway ws url must use ws or wss scheme",
    );
  });
});
