import {
  IntegrationRegistry,
  type AnyIntegrationDefinition,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { AwsDefinition } from "./aws/server.js";
import { GitHubCloudDefinition, GitHubEnterpriseServerDefinition } from "./github/index.js";
import { JiraDefinition } from "./jira/index.js";
import { LinearDefinition } from "./linear/index.js";
import { OpenAiApiKeyDefinition } from "./openai/index.js";
import { PlanetScaleDefinition } from "./planetscale/server.js";
import { createAgentRuntimeRegistry } from "./registry/agent-runtimes.js";
import { SignozDefinition } from "./signoz/server.js";
import { SlackDefinition } from "./slack/index.js";

export * from "./aws/server.js";
export * from "./egress-telemetry.server.js";
export * from "./jira/index.js";
export * from "./github/index.js";
export * from "./linear/index.js";
export * from "./openai/index.js";
export * from "./planetscale/server.js";
export * from "./signoz/server.js";
export * from "./slack/index.js";
export * from "./forms/index.js";
export * from "./registry/agent-runtimes.js";

const RegisteredIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  AwsDefinition,
  JiraDefinition,
  GitHubCloudDefinition,
  GitHubEnterpriseServerDefinition,
  LinearDefinition,
  OpenAiApiKeyDefinition,
  PlanetScaleDefinition,
  SignozDefinition,
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
