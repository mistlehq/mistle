import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AgentConversationStatuses } from "../agent/index.js";
import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import { AgentRuntimeRegistry } from "./registry.js";

const RuntimeConfigSchema = z.object({});

function createConversationProvider() {
  return {
    connect: async () => ({
      request: async () => ({ ok: true }),
      close: async () => {},
    }),
    inspectConversation: async () => ({
      exists: true,
      status: AgentConversationStatuses.IDLE,
      activeExecutionId: null,
    }),
    createConversation: async () => ({
      providerConversationId: "thread_123",
    }),
    resumeConversation: async () => {},
    startExecution: async () => ({
      providerExecutionId: null,
    }),
  };
}

function createExecutionObserver() {
  return {
    createSession: () => ({
      onInboundMessage: () => {},
      onOutboundMessage: () => {},
      drainObservations: () => [],
    }),
  };
}

describe("agent runtime registry", () => {
  it("registers and resolves runtimes by runtimeId", () => {
    const registry = new AgentRuntimeRegistry();

    registry.register({
      runtimeId: "codex",
      displayName: "Codex",
      configSchema: RuntimeConfigSchema,
      compileRuntime: () => ({
        runtimeClients: [],
        agentRuntimes: [],
      }),
      createConversationProvider,
      createExecutionObserver,
    });

    expect(registry.getRuntime({ runtimeId: "codex" })?.displayName).toBe("Codex");
  });

  it("rejects duplicate runtime ids", () => {
    const registry = new AgentRuntimeRegistry();
    const runtime = {
      runtimeId: "codex",
      displayName: "Codex",
      configSchema: RuntimeConfigSchema,
      compileRuntime: () => ({
        runtimeClients: [],
        agentRuntimes: [],
      }),
      createConversationProvider,
      createExecutionObserver,
    };

    registry.register(runtime);

    expect(() => registry.register(runtime)).toThrow(IntegrationDefinitionRegistryError);
    expect(() => registry.register(runtime)).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.DUPLICATE_DEFINITION,
      }),
    );
  });

  it("rejects runtimes that omit server entrypoints required in phase 1", () => {
    const registry = new AgentRuntimeRegistry();

    expect(() =>
      registry.register({
        runtimeId: "codex",
        displayName: "Codex",
        configSchema: RuntimeConfigSchema,
        compileRuntime: () => ({
          runtimeClients: [],
          agentRuntimes: [],
        }),
        createExecutionObserver,
      }),
    ).toThrow(IntegrationDefinitionRegistryError);
  });
});
