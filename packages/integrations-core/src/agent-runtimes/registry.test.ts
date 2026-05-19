import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import { AgentRuntimeRegistry } from "./registry.js";

const RuntimeConfigSchema = z.object({});

describe("agent runtime registry", () => {
  it("registers and resolves runtimes by runtimeId", () => {
    const registry = new AgentRuntimeRegistry();

    registry.register({
      runtimeId: "codex",
      displayName: "Codex",
      logoKey: "openai",
      configSchema: RuntimeConfigSchema,
      compileRuntime: () => ({
        runtimeClients: [],
        agentRuntimes: [],
      }),
    });

    expect(registry.getRuntime({ runtimeId: "codex" })?.displayName).toBe("Codex");
  });

  it("rejects duplicate runtime ids", () => {
    const registry = new AgentRuntimeRegistry();
    const runtime = {
      runtimeId: "codex",
      displayName: "Codex",
      logoKey: "openai",
      configSchema: RuntimeConfigSchema,
      compileRuntime: () => ({
        runtimeClients: [],
        agentRuntimes: [],
      }),
    };

    registry.register(runtime);

    expect(() => registry.register(runtime)).toThrow(IntegrationDefinitionRegistryError);
    expect(() => registry.register(runtime)).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.DUPLICATE_DEFINITION,
      }),
    );
  });

  it("allows runtimes without optional server entrypoints", () => {
    const registry = new AgentRuntimeRegistry();

    registry.register({
      runtimeId: "codex",
      displayName: "Codex",
      logoKey: "openai",
      configSchema: RuntimeConfigSchema,
      compileRuntime: () => ({
        runtimeClients: [],
        agentRuntimes: [],
      }),
    });

    expect(registry.getRuntime({ runtimeId: "codex" })?.runtimeId).toBe("codex");
  });
});
