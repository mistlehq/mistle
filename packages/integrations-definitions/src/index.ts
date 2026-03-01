import { IntegrationRegistry, type IntegrationDefinition } from "@mistle/integrations-core";

import { GitHubCloudDefinition, GitHubEnterpriseServerDefinition } from "./github/index.js";
import { OpenAiApiKeyDefinition } from "./openai/index.js";

export * from "./github/index.js";
export * from "./openai/index.js";

const RegisteredIntegrationDefinitions: ReadonlyArray<IntegrationDefinition> = [
  GitHubCloudDefinition,
  GitHubEnterpriseServerDefinition,
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
