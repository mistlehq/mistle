import { supportsAssociatedResourceDeliveryRuntime } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { createAgentRuntimeRegistry } from "./agent-runtimes.js";

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
});
