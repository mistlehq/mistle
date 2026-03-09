import { describe, expect, it } from "vitest";

import {
  AgentRuntimeRegistry,
  AgentRuntimeRegistryError,
  AgentRuntimeRegistryErrorCodes,
  createAgentRuntimeRegistry,
  listAgentRuntimes,
} from "./index.js";

describe("agent runtimes registry", () => {
  it("registers the openai codex agent runtime", () => {
    const registry = createAgentRuntimeRegistry();
    const runtime = registry.getRuntimeOrThrow({
      familyId: "openai",
      variantId: "openai-default",
      runtimeKey: "codex-app-server",
    });

    expect(runtime.capabilities.conversation?.providerFamily).toBe("codex");
    expect(typeof runtime.capabilities.conversation?.createAdapter).toBe("function");
  });

  it("lists registered runtimes deterministically", () => {
    expect(listAgentRuntimes()).toEqual([
      {
        familyId: "openai",
        variantId: "openai-default",
        runtimeKey: "codex-app-server",
        capabilities: {
          conversation: {
            providerFamily: "codex",
            createAdapter: expect.any(Function),
          },
        },
      },
    ]);
  });

  it("rejects duplicate registrations", () => {
    const registry = new AgentRuntimeRegistry();
    const runtime = listAgentRuntimes()[0];
    expect(runtime).toBeDefined();
    if (runtime === undefined) {
      throw new Error("Expected at least one registered agent runtime.");
    }
    registry.register(runtime);

    try {
      registry.register(runtime);
      throw new Error("Expected duplicate runtime registration to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentRuntimeRegistryError);
      expect(error).toMatchObject({
        code: AgentRuntimeRegistryErrorCodes.DUPLICATE_RUNTIME,
        message: "Agent runtime 'openai::openai-default::codex-app-server' is already registered.",
      });
    }
  });
});
