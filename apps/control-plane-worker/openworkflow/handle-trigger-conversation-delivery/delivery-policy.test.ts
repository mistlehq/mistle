import { AgentRuntimeRegistry, type AgentRuntimeDefinition } from "@mistle/integrations-core";
import { createDefinitionsBundle } from "@mistle/integrations-definitions/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { resolveAgentRuntimeConversationDeliveryPolicy } from "./delivery-policy.js";

const RuntimeConfigSchema = z.object({});

function createRuntimeWithoutConversationDeliveryPolicy(): AgentRuntimeDefinition<
  typeof RuntimeConfigSchema
> {
  return {
    runtimeId: "custom-runtime",
    displayName: "Custom Runtime",
    logoKey: "custom-runtime",
    configSchema: RuntimeConfigSchema,
    compileRuntime: () => ({
      runtimeClients: [],
      agentRuntimes: [],
    }),
  };
}

describe("resolveAgentRuntimeConversationDeliveryPolicy", () => {
  it("resolves trigger conversation delivery policy from provider runtime metadata", () => {
    const { agentRuntimeRegistry } = createDefinitionsBundle();

    for (const runtimeId of ["codex", "opencode", "pi"]) {
      expect(
        resolveAgentRuntimeConversationDeliveryPolicy(
          {
            agentRuntimeRegistry,
          },
          {
            runtimeId,
          },
        ),
      ).toEqual({
        idempotencyFingerprintRuntimeKey: runtimeId,
        createConversationRetryPolicy: "idempotent",
      });
    }
  });

  it("fails explicitly when the runtime is missing", () => {
    const agentRuntimeRegistry = new AgentRuntimeRegistry();

    expect(() =>
      resolveAgentRuntimeConversationDeliveryPolicy(
        {
          agentRuntimeRegistry,
        },
        {
          runtimeId: "unsupported",
        },
      ),
    ).toThrow(
      "Agent runtime 'unsupported' was not found while resolving trigger conversation delivery policy.",
    );
  });

  it("fails explicitly when the runtime has no trigger conversation delivery policy", () => {
    const agentRuntimeRegistry = new AgentRuntimeRegistry();
    agentRuntimeRegistry.register(createRuntimeWithoutConversationDeliveryPolicy());

    expect(() =>
      resolveAgentRuntimeConversationDeliveryPolicy(
        {
          agentRuntimeRegistry,
        },
        {
          runtimeId: "custom-runtime",
        },
      ),
    ).toThrow(
      "Agent runtime 'custom-runtime' does not define trigger conversation delivery policy.",
    );
  });
});
