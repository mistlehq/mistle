import {
  IntegrationRegistry,
  type AnyIntegrationDefinition,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { AtlassianDefinition } from "./atlassian/index.js";
import { GitHubCloudDefinition, GitHubEnterpriseServerDefinition } from "./github/index.js";
import { LinearDefinition } from "./linear/index.js";
import { OpenAiApiKeyDefinition } from "./openai/index.js";
import { createAgentRuntimeRegistry } from "./registry/agent-runtimes.js";

export * from "./atlassian/index.js";
export * from "./github/index.js";
export * from "./linear/index.js";
export * from "./openai/index.js";
export * from "./forms/index.js";
export * from "./registry/agent-runtimes.js";

const RegisteredIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  AtlassianDefinition,
  GitHubCloudDefinition,
  GitHubEnterpriseServerDefinition,
  LinearDefinition,
  OpenAiApiKeyDefinition,
];

export function listIntegrationDefinitions(): ReadonlyArray<AnyIntegrationDefinition> {
  return RegisteredIntegrationDefinitions;
}

export function createIntegrationRegistry(): IntegrationRegistry {
  const registry = new IntegrationRegistry();
  registry.registerMany(RegisteredIntegrationDefinitions);
  return registry;
}

export function createDefinitionsBundle(): IntegrationDefinitionsBundle {
  return {
    integrationRegistry: createIntegrationRegistry(),
    agentRuntimeRegistry: createAgentRuntimeRegistry(),
  };
}
