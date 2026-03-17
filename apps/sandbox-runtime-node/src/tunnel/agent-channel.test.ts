import type { CompiledAgentRuntime, CompiledRuntimeClient } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveAgentEndpoint } from "./agent-channel.js";

function createRuntimeClient(overrides: Partial<CompiledRuntimeClient>): CompiledRuntimeClient {
  return {
    clientId: "client_openai",
    setup: {
      env: {},
      files: [],
    },
    processes: [],
    endpoints: [
      {
        endpointKey: "app-server",
        transport: {
          type: "ws",
          url: "ws://127.0.0.1:4020/app-server",
        },
        connectionMode: "dedicated",
      },
    ],
    ...overrides,
  };
}

function createAgentRuntime(overrides: Partial<CompiledAgentRuntime>): CompiledAgentRuntime {
  return {
    bindingId: "binding_openai",
    runtimeKey: "codex-app-server",
    clientId: "client_openai",
    endpointKey: "app-server",
    adapterKey: "openai-codex",
    ...overrides,
  };
}

describe("resolveAgentEndpoint", () => {
  it("returns undefined when the runtime plan does not declare an agent runtime", () => {
    expect(resolveAgentEndpoint([], [])).toBeUndefined();
  });

  it("resolves the declared websocket endpoint", () => {
    const resolvedEndpoint = resolveAgentEndpoint(
      [createAgentRuntime({})],
      [createRuntimeClient({})],
    );

    expect(resolvedEndpoint).toEqual({
      runtimeKey: "codex-app-server",
      clientId: "client_openai",
      endpointKey: "app-server",
      connectionMode: "dedicated",
      transportUrl: "ws://127.0.0.1:4020/app-server",
    });
  });

  it("fails when the runtime references a missing client", () => {
    expect(() =>
      resolveAgentEndpoint(
        [createAgentRuntime({ clientId: "missing-client" })],
        [createRuntimeClient({})],
      ),
    ).toThrow("references missing runtime client 'missing-client'");
  });
});
