import {
  IntegrationRegistry,
  type AnyIntegrationDefinition,
  type AnyAgentRuntimeMetadata,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { AgentMailDefinition } from "./agentmail/browser.js";
import { AnthropicDefinition } from "./anthropic/index.js";
import { AutumnDefinition } from "./autumn/browser.js";
import { AwsDefinition } from "./aws/browser.js";
import { BugSnagDefinition } from "./bugsnag/browser.js";
import { CloudflareDefinition } from "./cloudflare/browser.js";
import { DatadogDefinition } from "./datadog/index.js";
import { DeepSeekDefinition } from "./deepseek/index.js";
import { ExpoDefinition } from "./expo/browser.js";
import { FireworksDefinition } from "./fireworks/index.js";
import { GcpDefinition } from "./gcp/browser.js";
import { GitHubCloudDefinition, GitHubEnterpriseServerDefinition } from "./github/browser.js";
import { GoogleAnalyticsDefinition } from "./google-analytics/browser.js";
import { GoogleSearchConsoleDefinition } from "./google-search-console/browser.js";
import { GoogleWorkspaceDefinition } from "./google-workspace/browser.js";
import { InceptionDefinition } from "./inception/index.js";
import { JiraDefinition } from "./jira/browser.js";
import { KimiDefinition } from "./kimi/index.js";
import { KlaviyoDefinition } from "./klaviyo/browser.js";
import { LinearBaseDefinition } from "./linear/variants/linear-default/base-definition.js";
import { MetaAdsDefinition } from "./metaads/browser.js";
import { MiniMaxDefinition } from "./minimax/index.js";
import { NotionDefinition } from "./notion/browser.js";
import { OpenAiApiKeyDefinition } from "./openai/index.js";
import { OpenCodeGoDefinition } from "./opencode/index.js";
import { OpenRouterDefinition } from "./openrouter/index.js";
import { PlanetScaleDefinition } from "./planetscale/browser.js";
import { PostHogDefinition } from "./posthog/browser.js";
import { RailwayDefinition } from "./railway/browser.js";
import { createAgentRuntimeRegistry } from "./registry/agent-runtimes.js";
import { RenderDefinition } from "./render/index.js";
import { ResendDefinition } from "./resend/browser.js";
import {
  E2BSandboxRuntimeDefinition,
  ModalSandboxRuntimeDefinition,
  OpenComputerSandboxRuntimeDefinition,
  TensorlakeSandboxRuntimeDefinition,
} from "./sandbox-runtimes/index.js";
import { SentryDefinition } from "./sentry/browser.js";
import { ShopifyDefinition } from "./shopify/browser.js";
import { SignozDefinition } from "./signoz/browser.js";
import { SlackDefinition } from "./slack/browser.js";
import { StripeDefinition } from "./stripe/browser.js";
import { SupabaseDefinition } from "./supabase/browser.js";
import { WasenderApiDefinition } from "./wasenderapi/browser.js";
import { WhapiDefinition } from "./whapi/browser.js";
import { ZaiDefinition } from "./zai/index.js";

export * from "./agentmail/browser.js";
export * from "./anthropic/index.js";
export * from "./autumn/browser.js";
export * from "./aws/browser.js";
export * from "./bugsnag/browser.js";
export * from "./cloudflare/browser.js";
export * from "./datadog/index.js";
export * from "./deepseek/index.js";
export * from "./expo/browser.js";
export * from "./fireworks/index.js";
export * from "./gcp/browser.js";
export * from "./google-analytics/browser.js";
export * from "./google-search-console/browser.js";
export * from "./google-workspace/browser.js";
export * from "./jira/browser.js";
export * from "./jira-shared.js";
export * from "./github/browser.js";
export * from "./inception/index.js";
export * from "./kimi/index.js";
export * from "./klaviyo/browser.js";
export * from "./linear/browser.js";
export * from "./metaads/browser.js";
export * from "./minimax/index.js";
export * from "./notion/browser.js";
export * from "./openai/index.js";
export * from "./opencode/index.js";
export * from "./openrouter/index.js";
export * from "./planetscale/browser.js";
export * from "./posthog/browser.js";
export * from "./railway/browser.js";
export * from "./render/index.js";
export * from "./resend/browser.js";
export * from "./sandbox-runtimes/index.js";
export * from "./sentry/browser.js";
export * from "./signoz/browser.js";
export * from "./slack/browser.js";
export * from "./shopify/browser.js";
export * from "./stripe/browser.js";
export * from "./supabase/browser.js";
export * from "./wasenderapi/browser.js";
export * from "./whapi/browser.js";
export * from "./zai/index.js";
export * from "./forms/index.js";
export * from "./agent-runtimes/provider-selection.js";
export * from "./registry/agent-runtimes.js";
export * from "./shared/remote-mcp-server-catalog/index.js";

const RegisteredIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  AgentMailDefinition,
  AnthropicDefinition,
  AutumnDefinition,
  AwsDefinition,
  BugSnagDefinition,
  CloudflareDefinition,
  DatadogDefinition,
  DeepSeekDefinition,
  ExpoDefinition,
  FireworksDefinition,
  GcpDefinition,
  GoogleAnalyticsDefinition,
  GoogleSearchConsoleDefinition,
  GoogleWorkspaceDefinition,
  InceptionDefinition,
  JiraDefinition,
  KimiDefinition,
  KlaviyoDefinition,
  GitHubCloudDefinition,
  GitHubEnterpriseServerDefinition,
  LinearBaseDefinition,
  MetaAdsDefinition,
  MiniMaxDefinition,
  NotionDefinition,
  OpenAiApiKeyDefinition,
  OpenCodeGoDefinition,
  OpenRouterDefinition,
  PlanetScaleDefinition,
  PostHogDefinition,
  RailwayDefinition,
  RenderDefinition,
  ResendDefinition,
  E2BSandboxRuntimeDefinition,
  ModalSandboxRuntimeDefinition,
  OpenComputerSandboxRuntimeDefinition,
  TensorlakeSandboxRuntimeDefinition,
  SentryDefinition,
  SignozDefinition,
  SlackDefinition,
  ShopifyDefinition,
  StripeDefinition,
  SupabaseDefinition,
  WasenderApiDefinition,
  WhapiDefinition,
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
