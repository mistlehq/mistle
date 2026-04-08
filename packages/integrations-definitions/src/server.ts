import {
  IntegrationRegistry,
  type AnyIntegrationDefinition,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { GitHubCloudDefinition, GitHubEnterpriseServerDefinition } from "./github/index.js";
import { JiraDefinition } from "./jira/index.js";
import { LinearDefinition } from "./linear/index.js";
import { OpenAiApiKeyDefinition } from "./openai/index.js";
import { createAgentRuntimeRegistry } from "./registry/agent-runtimes.js";
import { SlackDefinition } from "./slack/index.js";

export * from "./jira/index.js";
export * from "./github/index.js";
export * from "./linear/index.js";
export * from "./openai/index.js";
export * from "./slack/index.js";
export * from "./forms/index.js";
export * from "./registry/agent-runtimes.js";

const RegisteredIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  JiraDefinition,
  GitHubCloudDefinition,
  GitHubEnterpriseServerDefinition,
  LinearDefinition,
  OpenAiApiKeyDefinition,
  SlackDefinition,
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
