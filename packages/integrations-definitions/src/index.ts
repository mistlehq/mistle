import { IntegrationRegistry, type IntegrationDefinition } from "@mistle/integrations-core";

import { OpenAiApiKeyDefinition } from "./openai/index.js";

export * from "./openai/index.js";

const RegisteredIntegrationDefinitions: ReadonlyArray<IntegrationDefinition> = [
  OpenAiApiKeyDefinition,
];

export function listIntegrationDefinitions(): ReadonlyArray<IntegrationDefinition> {
  return RegisteredIntegrationDefinitions;
}

export function createIntegrationRegistry(): IntegrationRegistry {
  const registry = new IntegrationRegistry();
  registry.registerMany(RegisteredIntegrationDefinitions);
  return registry;
}
