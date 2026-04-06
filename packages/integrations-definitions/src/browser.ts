import {
  IntegrationRegistry,
  type AnyIntegrationDefinition,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { GitHubCloudBaseDefinition } from "./github/variants/github-cloud/base-definition.js";
import { GitHubEnterpriseServerBaseDefinition } from "./github/variants/github-enterprise-server/base-definition.js";
import { JiraBaseDefinition } from "./jira/variants/jira-default/base-definition.js";
import { LinearDefinition } from "./linear/variants/linear-default/definition.js";
import { OpenAiApiKeyDefinition } from "./openai/variants/openai-default/definition.js";
import { createAgentRuntimeRegistry } from "./registry/agent-runtimes.js";
export const GitHubCloudBrowserDefinition = GitHubCloudBaseDefinition;
export const GitHubEnterpriseServerBrowserDefinition = GitHubEnterpriseServerBaseDefinition;
export const JiraBrowserDefinition = JiraBaseDefinition;
export const LinearBrowserDefinition = LinearDefinition;

const BrowserIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  JiraBrowserDefinition,
  GitHubCloudBrowserDefinition,
  GitHubEnterpriseServerBrowserDefinition,
  LinearBrowserDefinition,
  OpenAiApiKeyDefinition,
];

export function listBrowserIntegrationDefinitions(): ReadonlyArray<AnyIntegrationDefinition> {
  return BrowserIntegrationDefinitions;
}

export function createBrowserIntegrationRegistry(): IntegrationRegistry {
  const registry = new IntegrationRegistry();
  registry.registerMany(BrowserIntegrationDefinitions);
  return registry;
}

export function createBrowserDefinitionsBundle(): IntegrationDefinitionsBundle {
  return {
    integrationRegistry: createBrowserIntegrationRegistry(),
    agentRuntimeRegistry: createAgentRuntimeRegistry(),
  };
}
