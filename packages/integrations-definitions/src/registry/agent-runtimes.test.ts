import { supportsAssociatedResourceDeliveryRuntime } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { createAgentRuntimeRegistry } from "./agent-runtimes.js";
import { createAgentRuntimeServerRegistry } from "./agent-runtimes.server.js";

describe("createAgentRuntimeRegistry", () => {
  it("registers associated-resource-capable provider runtimes with capability metadata", () => {
    const registry = createAgentRuntimeRegistry();

    for (const runtimeId of ["codex", "opencode", "pi"]) {
      const runtime = registry.getRuntimeOrThrow({ runtimeId });
      expect(supportsAssociatedResourceDeliveryRuntime(runtime)).toBe(true);
    }
  });

  it("registers provider runtimes with trigger conversation delivery policy metadata", () => {
    const registry = createAgentRuntimeRegistry();

    for (const runtimeId of ["codex", "opencode", "pi"]) {
      const runtime = registry.getRuntimeOrThrow({ runtimeId });
      expect(runtime.capabilities?.conversationDelivery).toEqual({
        idempotencyFingerprintRuntimeKey: runtimeId,
        createConversationRetryPolicy: "idempotent",
      });
    }
  });

  it("keeps compile functions out of browser metadata registry entries", () => {
    const registry = createAgentRuntimeRegistry();

    for (const runtime of registry.listRuntimes()) {
      expect(Object.hasOwn(runtime, "compileRuntime")).toBe(false);
    }
  });

  it("registers compile-capable provider runtimes in the server registry", () => {
    const registry = createAgentRuntimeServerRegistry();

    for (const runtimeId of ["codex", "opencode", "pi"]) {
      const runtime = registry.getRuntimeOrThrow({ runtimeId });
      expect(Object.hasOwn(runtime, "compileRuntime")).toBe(true);
    }
  });
});
