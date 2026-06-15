import {
  IntegrationRegistry,
  type AnyAgentRuntimeMetadata,
  type AnyIntegrationDefinition,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { AnthropicDefinition } from "./anthropic/index.js";
import { AwsBaseDefinition } from "./aws/variants/aws-cli-default/base-definition.js";
import { BugSnagMcpBaseDefinition } from "./bugsnag/variants/bugsnag-mcp/base-definition.js";
import { CloudflareDefinition } from "./cloudflare/variants/cloudflare-mcp/definition.js";
import { DatadogDefinition } from "./datadog/index.js";
import { DeepSeekDefinition } from "./deepseek/index.js";
import { ExpoMcpBaseDefinition } from "./expo/variants/expo-mcp/base-definition.js";
import { FireworksDefinition } from "./fireworks/index.js";
import { GcpMcpBaseDefinition } from "./gcp/variants/gcp-mcp/base-definition.js";
import { GitHubCloudBaseDefinition } from "./github/variants/github-cloud/base-definition.js";
import { GitHubEnterpriseServerBaseDefinition } from "./github/variants/github-enterprise-server/base-definition.js";
import { InceptionDefinition } from "./inception/index.js";
import { JiraBaseDefinition } from "./jira/variants/jira-default/base-definition.js";
import { KimiDefinition } from "./kimi/index.js";
import { LinearBaseDefinition } from "./linear/variants/linear-default/base-definition.js";
import { MiniMaxDefinition } from "./minimax/index.js";
import { NotionMcpBaseDefinition } from "./notion/variants/notion-mcp/base-definition.js";
import { OpenAiApiKeyDefinition } from "./openai/variants/openai-default/definition.js";
import { OpenCodeGoDefinition } from "./opencode/index.js";
import { PlanetScaleMcpBaseDefinition } from "./planetscale/variants/planetscale-mcp/base-definition.js";
import { PostHogMcpBaseDefinition } from "./posthog/variants/posthog-mcp/base-definition.js";
import { createAgentRuntimeRegistry } from "./registry/agent-runtimes.js";
import { ResendMcpBaseDefinition } from "./resend/variants/resend-mcp/base-definition.js";
import {
  E2BSandboxRuntimeDefinition,
  ModalSandboxRuntimeDefinition,
  OpenComputerSandboxRuntimeDefinition,
  TensorlakeSandboxRuntimeDefinition,
} from "./sandbox-runtimes/index.js";
import { SentryMcpBaseDefinition } from "./sentry/variants/sentry-mcp/base-definition.js";
import { SignozMcpBaseDefinition } from "./signoz/variants/signoz-mcp/base-definition.js";
import { SlackBaseDefinition } from "./slack/variants/slack-default/base-definition.js";
import { ZaiDefinition } from "./zai/index.js";
export const AnthropicBrowserDefinition = AnthropicDefinition;
export const AwsBrowserDefinition = AwsBaseDefinition;
export const BugSnagBrowserDefinition = BugSnagMcpBaseDefinition;
export const CloudflareBrowserDefinition = CloudflareDefinition;
export const DatadogBrowserDefinition = DatadogDefinition;
export const DeepSeekBrowserDefinition = DeepSeekDefinition;
export const ExpoBrowserDefinition = ExpoMcpBaseDefinition;
export const FireworksBrowserDefinition = FireworksDefinition;
export const GcpBrowserDefinition = GcpMcpBaseDefinition;
export const GitHubCloudBrowserDefinition = GitHubCloudBaseDefinition;
export const GitHubEnterpriseServerBrowserDefinition = GitHubEnterpriseServerBaseDefinition;
export const InceptionBrowserDefinition = InceptionDefinition;
export const JiraBrowserDefinition = JiraBaseDefinition;
export const KimiBrowserDefinition = KimiDefinition;
export const LinearBrowserDefinition = LinearBaseDefinition;
export const MiniMaxBrowserDefinition = MiniMaxDefinition;
export const NotionBrowserDefinition = NotionMcpBaseDefinition;
export const OpenCodeGoBrowserDefinition = OpenCodeGoDefinition;
export const PlanetScaleBrowserDefinition = PlanetScaleMcpBaseDefinition;
export const PostHogBrowserDefinition = PostHogMcpBaseDefinition;
export const ResendBrowserDefinition = ResendMcpBaseDefinition;
export const E2BSandboxRuntimeBrowserDefinition = E2BSandboxRuntimeDefinition;
export const ModalSandboxRuntimeBrowserDefinition = ModalSandboxRuntimeDefinition;
export const OpenComputerSandboxRuntimeBrowserDefinition = OpenComputerSandboxRuntimeDefinition;
export const TensorlakeSandboxRuntimeBrowserDefinition = TensorlakeSandboxRuntimeDefinition;
export const SentryBrowserDefinition = SentryMcpBaseDefinition;
export const SignozBrowserDefinition = SignozMcpBaseDefinition;
export const SlackBrowserDefinition = SlackBaseDefinition;
export const ZaiBrowserDefinition = ZaiDefinition;

const BrowserIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  AnthropicBrowserDefinition,
  AwsBrowserDefinition,
  BugSnagBrowserDefinition,
  CloudflareBrowserDefinition,
  DatadogBrowserDefinition,
  DeepSeekBrowserDefinition,
  ExpoBrowserDefinition,
  FireworksBrowserDefinition,
  GcpBrowserDefinition,
  InceptionBrowserDefinition,
  JiraBrowserDefinition,
  KimiBrowserDefinition,
  GitHubCloudBrowserDefinition,
  GitHubEnterpriseServerBrowserDefinition,
  LinearBrowserDefinition,
  MiniMaxBrowserDefinition,
  NotionBrowserDefinition,
  OpenAiApiKeyDefinition,
  OpenCodeGoBrowserDefinition,
  PlanetScaleBrowserDefinition,
  PostHogBrowserDefinition,
  ResendBrowserDefinition,
  E2BSandboxRuntimeBrowserDefinition,
  ModalSandboxRuntimeBrowserDefinition,
  OpenComputerSandboxRuntimeBrowserDefinition,
  TensorlakeSandboxRuntimeBrowserDefinition,
  SentryBrowserDefinition,
  SignozBrowserDefinition,
  SlackBrowserDefinition,
  ZaiBrowserDefinition,
];

export function listBrowserIntegrationDefinitions(): ReadonlyArray<AnyIntegrationDefinition> {
  return BrowserIntegrationDefinitions;
}

export function createBrowserIntegrationRegistry(): IntegrationRegistry {
  const registry = new IntegrationRegistry();
  registry.registerMany(BrowserIntegrationDefinitions);
  return registry;
}

export function createBrowserDefinitionsBundle(): IntegrationDefinitionsBundle<AnyAgentRuntimeMetadata> {
  return {
    integrationRegistry: createBrowserIntegrationRegistry(),
    agentRuntimeRegistry: createAgentRuntimeRegistry(),
  };
}

export * from "./anthropic/index.js";
export * from "./agent-runtimes/provider-selection.js";
export * from "./bugsnag/browser.js";
export * from "./cloudflare/browser.js";
export * from "./datadog/index.js";
export * from "./deepseek/index.js";
export * from "./expo/browser.js";
export * from "./fireworks/index.js";
export * from "./gcp/browser.js";
export * from "./github/browser.js";
export * from "./inception/index.js";
export * from "./jira/browser.js";
export * from "./kimi/index.js";
export * from "./linear/browser.js";
export * from "./minimax/index.js";
export * from "./notion/browser.js";
export * from "./opencode/index.js";
export * from "./posthog/browser.js";
export * from "./resend/browser.js";
export * from "./sandbox-runtimes/index.js";
export * from "./sentry/browser.js";
export * from "./shared/remote-mcp-server-catalog/index.js";
export * from "./slack/browser.js";
export * from "./zai/index.js";
