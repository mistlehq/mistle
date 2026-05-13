import {
  IntegrationRegistry,
  type AnyIntegrationDefinition,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { AnthropicDefinition } from "./anthropic/index.js";
import { AwsBaseDefinition } from "./aws/variants/aws-cli-default/base-definition.js";
import { DatadogDefinition } from "./datadog/index.js";
import { GitHubCloudBaseDefinition } from "./github/variants/github-cloud/base-definition.js";
import { GitHubEnterpriseServerBaseDefinition } from "./github/variants/github-enterprise-server/base-definition.js";
import { JiraBaseDefinition } from "./jira/variants/jira-default/base-definition.js";
import { LinearDefinition } from "./linear/variants/linear-default/definition.js";
import { OpenAiApiKeyDefinition } from "./openai/variants/openai-default/definition.js";
import { OpenCodeGoDefinition } from "./opencode/index.js";
import { PlanetScaleMcpBaseDefinition } from "./planetscale/variants/planetscale-mcp/base-definition.js";
import { createAgentRuntimeRegistry } from "./registry/agent-runtimes.js";
import { E2BSandboxRuntimeDefinition } from "./sandbox-runtimes/index.js";
import { SignozMcpBaseDefinition } from "./signoz/variants/signoz-mcp/base-definition.js";
import { SlackBaseDefinition } from "./slack/variants/slack-default/base-definition.js";
export const AnthropicBrowserDefinition = AnthropicDefinition;
export const AwsBrowserDefinition = AwsBaseDefinition;
export const DatadogBrowserDefinition = DatadogDefinition;
export const GitHubCloudBrowserDefinition = GitHubCloudBaseDefinition;
export const GitHubEnterpriseServerBrowserDefinition = GitHubEnterpriseServerBaseDefinition;
export const JiraBrowserDefinition = JiraBaseDefinition;
export const LinearBrowserDefinition = LinearDefinition;
export const OpenCodeGoBrowserDefinition = OpenCodeGoDefinition;
export const PlanetScaleBrowserDefinition = PlanetScaleMcpBaseDefinition;
export const E2BSandboxRuntimeBrowserDefinition = E2BSandboxRuntimeDefinition;
export const SignozBrowserDefinition = SignozMcpBaseDefinition;
export const SlackBrowserDefinition = SlackBaseDefinition;

const BrowserIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  AnthropicBrowserDefinition,
  AwsBrowserDefinition,
  DatadogBrowserDefinition,
  JiraBrowserDefinition,
  GitHubCloudBrowserDefinition,
  GitHubEnterpriseServerBrowserDefinition,
  LinearBrowserDefinition,
  OpenAiApiKeyDefinition,
  OpenCodeGoBrowserDefinition,
  PlanetScaleBrowserDefinition,
  E2BSandboxRuntimeBrowserDefinition,
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

export * from "./anthropic/index.js";
export * from "./agent-runtimes/provider-selection.js";
export * from "./datadog/index.js";
export * from "./github/browser.js";
export * from "./jira/browser.js";
export * from "./opencode/index.js";
export * from "./sandbox-runtimes/index.js";
export * from "./slack/browser.js";
