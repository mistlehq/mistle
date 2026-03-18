import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { ListenAddrEnv, TokenizerProxyEgressBaseUrlEnv } from "../src/runtime/config.js";
import { startRuntime, type StartedRuntime } from "../src/runtime/run.js";

const StartedRuntimes: StartedRuntime[] = [];

const ValidStartupInputJson = `{
  "bootstrapToken": "test-token",
  "tunnelExchangeToken": "test-exchange-token",
  "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox",
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

afterEach(async () => {
  while (StartedRuntimes.length > 0) {
    const runtime = StartedRuntimes.pop();
    if (runtime !== undefined) {
      await runtime.close();
    }
  }
});

describe("startRuntime", () => {
  it("serves the health endpoint after startup input is loaded", async () => {
    const runtime = await startRuntime({
      lookupEnv: createLookupEnv(),
      stdin: Readable.from([ValidStartupInputJson]),
    });
    void runtime.tunnelCompletion.catch(() => undefined);
    StartedRuntimes.push(runtime);

    const response = await fetch(`${runtime.baseUrl}/__healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.text()).resolves.toBe(`{"ok":true}`);
  });

  it("returns not found for unknown paths", async () => {
    const runtime = await startRuntime({
      lookupEnv: createLookupEnv(),
      stdin: Readable.from([ValidStartupInputJson]),
    });
    void runtime.tunnelCompletion.catch(() => undefined);
    StartedRuntimes.push(runtime);

    const response = await fetch(`${runtime.baseUrl}/healthz`);

    expect(response.status).toBe(404);
  });

  it("applies artifact env during runtime startup and restores it on close", async () => {
    const previousGhToken = process.env.GH_TOKEN;
    delete process.env.GH_TOKEN;

    const startupInputJson = `{
      "bootstrapToken": "test-token",
      "tunnelExchangeToken": "test-exchange-token",
      "tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox",
      "runtimePlan": {
        "sandboxProfileId": "sbp_123",
        "version": 1,
        "image": {
          "source": "base",
          "imageRef": "mistle/sandbox-base:dev"
        },
        "egressRoutes": [],
        "artifacts": [
          {
            "artifactKey": "gh-cli",
            "name": "GitHub CLI",
            "env": {
              "GH_TOKEN": "dummy-token"
            },
            "lifecycle": {
              "install": [],
              "remove": []
            }
          }
        ],
        "runtimeClients": [],
        "workspaceSources": [],
        "agentRuntimes": []
      }
    }`;

    const runtime = await startRuntime({
      lookupEnv: createLookupEnv(),
      stdin: Readable.from([startupInputJson]),
    });
    void runtime.tunnelCompletion.catch(() => undefined);

    try {
      expect(process.env.GH_TOKEN).toBe("dummy-token");
    } finally {
      await runtime.close();
    }

    expect(process.env.GH_TOKEN).toBe(previousGhToken);
  });
});
