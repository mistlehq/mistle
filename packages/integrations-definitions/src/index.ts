import {
  IntegrationRegistry,
  type AnyIntegrationDefinition,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { AnthropicDefinition } from "./anthropic/index.js";
import { AwsDefinition } from "./aws/browser.js";
import { DatadogDefinition } from "./datadog/index.js";
import { GcpDefinition } from "./gcp/browser.js";
import { GitHubCloudDefinition, GitHubEnterpriseServerDefinition } from "./github/browser.js";
import { JiraDefinition } from "./jira/browser.js";
import { LinearDefinition } from "./linear/index.js";
import { OpenAiApiKeyDefinition } from "./openai/index.js";
import { OpenCodeGoDefinition } from "./opencode/index.js";
import { PlanetScaleDefinition } from "./planetscale/browser.js";
import { createAgentRuntimeRegistry } from "./registry/agent-runtimes.js";
import {
  E2BSandboxRuntimeDefinition,
  TensorlakeSandboxRuntimeDefinition,
} from "./sandbox-runtimes/index.js";
import { SentryDefinition } from "./sentry/browser.js";
import { SignozDefinition } from "./signoz/browser.js";
import { SlackDefinition } from "./slack/browser.js";

export * from "./anthropic/index.js";
export * from "./aws/browser.js";
export * from "./datadog/index.js";
export * from "./gcp/browser.js";
export * from "./jira/browser.js";
export * from "./jira-shared.js";
export * from "./github/browser.js";
export * from "./linear/index.js";
export * from "./openai/index.js";
export * from "./opencode/index.js";
export * from "./planetscale/browser.js";
export * from "./sandbox-runtimes/index.js";
export * from "./sentry/browser.js";
export * from "./signoz/browser.js";
export * from "./slack/browser.js";
export * from "./forms/index.js";
export * from "./agent-runtimes/provider-selection.js";
export * from "./registry/agent-runtimes.js";
export * from "./shared/remote-mcp-server-catalog/index.js";

const RegisteredIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  AnthropicDefinition,
  AwsDefinition,
  DatadogDefinition,
  GcpDefinition,
  JiraDefinition,
  GitHubCloudDefinition,
  GitHubEnterpriseServerDefinition,
  LinearDefinition,
  OpenAiApiKeyDefinition,
  OpenCodeGoDefinition,
  PlanetScaleDefinition,
  E2BSandboxRuntimeDefinition,
  TensorlakeSandboxRuntimeDefinition,
  SentryDefinition,
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
