import {
  IntegrationRegistry,
  type AnyIntegrationDefinition,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { AwsDefinition } from "./aws/browser.js";
import { DatadogDefinition } from "./datadog/index.js";
import { GitHubCloudDefinition, GitHubEnterpriseServerDefinition } from "./github/browser.js";
import { JiraDefinition } from "./jira/browser.js";
import { LinearDefinition } from "./linear/index.js";
import { OpenAiApiKeyDefinition } from "./openai/index.js";
import { PlanetScaleDefinition } from "./planetscale/browser.js";
import { createAgentRuntimeRegistry } from "./registry/agent-runtimes.js";
import { SignozDefinition } from "./signoz/browser.js";
import { SlackDefinition } from "./slack/browser.js";

export * from "./aws/browser.js";
export * from "./datadog/index.js";
export * from "./jira/browser.js";
export * from "./github/browser.js";
export * from "./linear/index.js";
export * from "./openai/index.js";
export * from "./planetscale/browser.js";
export * from "./signoz/browser.js";
export * from "./slack/browser.js";
export * from "./forms/index.js";
export * from "./registry/agent-runtimes.js";

const RegisteredIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  AwsDefinition,
  DatadogDefinition,
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
