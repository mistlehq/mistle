import {
  IntegrationRegistry,
  type AnyIntegrationDefinition,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { AwsBaseDefinition } from "./aws/variants/aws-cli-default/base-definition.js";
import { DatadogDefinition } from "./datadog/index.js";
import { GitHubCloudBaseDefinition } from "./github/variants/github-cloud/base-definition.js";
import { GitHubEnterpriseServerBaseDefinition } from "./github/variants/github-enterprise-server/base-definition.js";
import { JiraBaseDefinition } from "./jira/variants/jira-default/base-definition.js";
import { LinearDefinition } from "./linear/variants/linear-default/definition.js";
import { OpenAiApiKeyDefinition } from "./openai/variants/openai-default/definition.js";
import { PlanetScaleMcpBaseDefinition } from "./planetscale/variants/planetscale-mcp/base-definition.js";
import { createAgentRuntimeRegistry } from "./registry/agent-runtimes.js";
import { SignozMcpBaseDefinition } from "./signoz/variants/signoz-mcp/base-definition.js";
import { SlackBaseDefinition } from "./slack/variants/slack-default/base-definition.js";
export const AwsBrowserDefinition = AwsBaseDefinition;
export const DatadogBrowserDefinition = DatadogDefinition;
export const GitHubCloudBrowserDefinition = GitHubCloudBaseDefinition;
export const GitHubEnterpriseServerBrowserDefinition = GitHubEnterpriseServerBaseDefinition;
export const JiraBrowserDefinition = JiraBaseDefinition;
export const LinearBrowserDefinition = LinearDefinition;
export const PlanetScaleBrowserDefinition = PlanetScaleMcpBaseDefinition;
export const SignozBrowserDefinition = SignozMcpBaseDefinition;
export const SlackBrowserDefinition = SlackBaseDefinition;

const BrowserIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  AwsBrowserDefinition,
  DatadogBrowserDefinition,
  JiraBrowserDefinition,
  GitHubCloudBrowserDefinition,
  GitHubEnterpriseServerBrowserDefinition,
  LinearBrowserDefinition,
  OpenAiApiKeyDefinition,
  PlanetScaleBrowserDefinition,
  SignozBrowserDefinition,
  SlackBrowserDefinition,
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

export * from "./datadog/index.js";
