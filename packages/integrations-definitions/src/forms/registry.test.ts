import {
  AgentConversationStatuses,
  AgentRuntimeRegistry,
  IntegrationKinds,
  IntegrationRegistry,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createIntegrationFormRegistry } from "./registry.js";

const ConfigSchema = z.record(z.string(), z.unknown());
const EmptySecretsSchema = z.object({});

function createAgentDefinition(): IntegrationDefinition<
  typeof ConfigSchema,
  typeof EmptySecretsSchema,
  typeof ConfigSchema
> {
  return {
    familyId: "openai",
    variantId: "openai-default",
    kind: IntegrationKinds.AGENT,
    displayName: "OpenAI",
    logoKey: "openai",
    targetConfigSchema: ConfigSchema,
    targetSecretSchema: EmptySecretsSchema,
    bindingConfigSchema: ConfigSchema,
    allowedRuntimeIds: ["codex"],
    connectionMethods: [
      {
        id: "api-key",
        label: "API key",
        kind: "form",
        secretFields: [
          {
            name: "apiKey",
            label: "API key",
            inputType: "password",
            secretType: "api_key",
          },
        ],
      },
    ],
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
    }),
  };
}

function registerRuntime(
  registry: AgentRuntimeRegistry,
  input: {
    runtimeId: string;
    displayName: string;
  },
): void {
  registry.register({
    runtimeId: input.runtimeId,
    displayName: input.displayName,
    configSchema: z.object({}),
    compileRuntime: () => ({
      runtimeClients: [],
      agentRuntimes: [],
    }),
    createConversationProvider: () => ({
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
      steerExecution: async () => ({
        providerExecutionId: "turn_123",
      }),
      interruptExecution: async () => {},
    }),
  });
}

describe("integration form registry", () => {
  it("derives browser-safe connection methods and runtime options from the definitions bundle", () => {
    const integrationRegistry = new IntegrationRegistry();
    integrationRegistry.register(createAgentDefinition());

    const agentRuntimeRegistry = new AgentRuntimeRegistry();
    registerRuntime(agentRuntimeRegistry, {
      runtimeId: "codex",
      displayName: "Codex",
    });

    const registry = createIntegrationFormRegistry({
      integrationRegistry,
      agentRuntimeRegistry,
    });

    expect(
      registry.getDefinition({
        familyId: "openai",
        variantId: "openai-default",
      }),
    ).toMatchObject({
      connectionMethods: [
        {
          id: "api-key",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
            },
          ],
        },
      ],
      agentRuntimeOptions: [
        {
          runtimeId: "codex",
          displayName: "Codex",
        },
      ],
    });
  });
});
