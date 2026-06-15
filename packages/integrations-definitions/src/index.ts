import {
  IntegrationRegistry,
  type AnyIntegrationDefinition,
  type AnyAgentRuntimeMetadata,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { AnthropicDefinition } from "./anthropic/index.js";
import { AwsDefinition } from "./aws/browser.js";
import { BugSnagDefinition } from "./bugsnag/browser.js";
import { CloudflareDefinition } from "./cloudflare/browser.js";
import { DatadogDefinition } from "./datadog/index.js";
import { DeepSeekDefinition } from "./deepseek/index.js";
import { ExpoDefinition } from "./expo/browser.js";
import { FireworksDefinition } from "./fireworks/index.js";
import { GcpDefinition } from "./gcp/browser.js";
import { GitHubCloudDefinition, GitHubEnterpriseServerDefinition } from "./github/browser.js";
import { JiraDefinition } from "./jira/browser.js";
import { KimiDefinition } from "./kimi/index.js";
import { LinearBaseDefinition } from "./linear/variants/linear-default/base-definition.js";
import { MiniMaxDefinition } from "./minimax/index.js";
import { OpenAiApiKeyDefinition } from "./openai/index.js";
import { OpenCodeGoDefinition } from "./opencode/index.js";
import { PlanetScaleDefinition } from "./planetscale/browser.js";
import { PostHogDefinition } from "./posthog/browser.js";
import { createAgentRuntimeRegistry } from "./registry/agent-runtimes.js";
import { ResendDefinition } from "./resend/browser.js";
import {
  E2BSandboxRuntimeDefinition,
  ModalSandboxRuntimeDefinition,
  OpenComputerSandboxRuntimeDefinition,
  TensorlakeSandboxRuntimeDefinition,
} from "./sandbox-runtimes/index.js";
import { SentryDefinition } from "./sentry/browser.js";
import { SignozDefinition } from "./signoz/browser.js";
import { SlackDefinition } from "./slack/browser.js";
import { ZaiDefinition } from "./zai/index.js";

export * from "./anthropic/index.js";
export * from "./aws/browser.js";
export * from "./bugsnag/browser.js";
export * from "./cloudflare/browser.js";
export * from "./datadog/index.js";
export * from "./deepseek/index.js";
export * from "./expo/browser.js";
export * from "./fireworks/index.js";
export * from "./gcp/browser.js";
export * from "./jira/browser.js";
export * from "./jira-shared.js";
export * from "./github/browser.js";
export * from "./kimi/index.js";
export * from "./linear/browser.js";
export * from "./minimax/index.js";
export * from "./openai/index.js";
export * from "./opencode/index.js";
export * from "./planetscale/browser.js";
export * from "./posthog/browser.js";
export * from "./resend/browser.js";
export * from "./sandbox-runtimes/index.js";
export * from "./sentry/browser.js";
export * from "./signoz/browser.js";
export * from "./slack/browser.js";
export * from "./zai/index.js";
export * from "./forms/index.js";
export * from "./agent-runtimes/provider-selection.js";
export * from "./registry/agent-runtimes.js";
export * from "./shared/remote-mcp-server-catalog/index.js";

const RegisteredIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  AnthropicDefinition,
  AwsDefinition,
  BugSnagDefinition,
  CloudflareDefinition,
  DatadogDefinition,
  DeepSeekDefinition,
  ExpoDefinition,
  FireworksDefinition,
  GcpDefinition,
  JiraDefinition,
  KimiDefinition,
  GitHubCloudDefinition,
  GitHubEnterpriseServerDefinition,
  LinearBaseDefinition,
  MiniMaxDefinition,
  OpenAiApiKeyDefinition,
  OpenCodeGoDefinition,
  PlanetScaleDefinition,
  PostHogDefinition,
  ResendDefinition,
  E2BSandboxRuntimeDefinition,
  ModalSandboxRuntimeDefinition,
  OpenComputerSandboxRuntimeDefinition,
  TensorlakeSandboxRuntimeDefinition,
  SentryDefinition,
  SignozDefinition,
  SlackDefinition,
  ZaiDefinition,
];

export function listIntegrationDefinitions(): ReadonlyArray<AnyIntegrationDefinition> {
  return RegisteredIntegrationDefinitions;
}

export function createIntegrationRegistry(): IntegrationRegistry {
  const registry = new IntegrationRegistry();
  registry.registerMany(RegisteredIntegrationDefinitions);
  return registry;
}

export function createDefinitionsBundle(): IntegrationDefinitionsBundle<AnyAgentRuntimeMetadata> {
  return {
    integrationRegistry: createIntegrationRegistry(),
    agentRuntimeRegistry: createAgentRuntimeRegistry(),
  };
}
