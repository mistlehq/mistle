import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { ListenAddrEnv, TokenizerProxyEgressBaseUrlEnv } from "../src/runtime/config.js";
import { startRuntime, type StartedRuntime } from "../src/runtime/run.js";

const StartedRuntimes: StartedRuntime[] = [];

const ValidStartupInputJson = `{
  "startupMode": "new",
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
  },
  "egressGrantByRuleId": {}
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

function parseLogPayload(line: string): Record<string, unknown> {
  const payload: unknown = JSON.parse(line);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("expected log line to be a json object");
  }

  return Object.fromEntries(Object.entries(payload));
}

function readBufferedLogPayloads(runtime: StartedRuntime): ReadonlyArray<Record<string, unknown>> {
  const payloads: Record<string, unknown>[] = [];
  runtime.logger.addLogLineListener((line) => {
    payloads.push(parseLogPayload(line));
  });
  return payloads;
}

function hasEvent(payloads: ReadonlyArray<Record<string, unknown>>, eventName: string): boolean {
  return payloads.some((payload) => payload["event"] === eventName);
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
      "startupMode": "new",
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
              "install": []
            }
          }
        ],
        "runtimeClients": [],
        "workspaceSources": [],
        "agentRuntimes": []
      },
      "egressGrantByRuleId": {}
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

  it("emits startup progress logs for config, input, and runtime-plan phases", async () => {
    const runtime = await startRuntime({
      lookupEnv: createLookupEnv(),
      stdin: Readable.from([ValidStartupInputJson]),
    });
    void runtime.tunnelCompletion.catch(() => undefined);

    try {
      const payloads = readBufferedLogPayloads(runtime);

      expect(hasEvent(payloads, "sandbox_runtime_config_loaded")).toBe(true);
      expect(hasEvent(payloads, "sandbox_runtime_startup_input_loaded")).toBe(true);
      expect(hasEvent(payloads, "sandbox_runtime_proxy_ca_not_configured")).toBe(true);
      expect(hasEvent(payloads, "sandbox_runtime_http_server_listening")).toBe(true);
      expect(hasEvent(payloads, "sandbox_runtime_plan_apply_started")).toBe(true);
      expect(hasEvent(payloads, "sandbox_runtime_plan_apply_completed")).toBe(true);
      expect(hasEvent(payloads, "sandbox_runtime_startup_ready")).toBe(true);
    } finally {
      await runtime.close();
    }
  });
});
