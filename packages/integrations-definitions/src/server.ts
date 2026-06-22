import {
  IntegrationRegistry,
  type IntegrationEgressRequestMiddleware,
  type EgressCredentialResolverRef,
  type IntegrationEgressCredentialResolverSelectionInput,
  type AnyIntegrationDefinition,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { AgentMailDefinition } from "./agentmail/server.js";
import { AnthropicDefinition } from "./anthropic/index.js";
import { AwsDefinition } from "./aws/server.js";
import { BugSnagDefinition } from "./bugsnag/server.js";
import { CloudflareDefinition } from "./cloudflare/server.js";
import { DatadogDefinition } from "./datadog/index.js";
import { DeepSeekDefinition } from "./deepseek/index.js";
import { resolveDefinitionEgressCredentialResolver } from "./egress-credential-resolver.server.js";
import { resolveDefinitionEgressRequestMiddleware } from "./egress-request-middleware.server.js";
import { ExpoDefinition } from "./expo/server.js";
import { FireworksDefinition } from "./fireworks/index.js";
import { GcpDefinition } from "./gcp/server.js";
import { GitHubCloudDefinition, GitHubEnterpriseServerDefinition } from "./github/index.js";
import { GoogleWorkspaceDefinition } from "./google-workspace/server.js";
import { InceptionDefinition } from "./inception/index.js";
import { JiraDefinition } from "./jira/index.js";
import { KimiDefinition } from "./kimi/index.js";
import { LinearDefinition } from "./linear/index.js";
import { MiniMaxDefinition } from "./minimax/index.js";
import { NotionDefinition } from "./notion/server.js";
import { OpenAiApiKeyDefinition } from "./openai/index.js";
import { OpenCodeGoDefinition } from "./opencode/index.js";
import { OpenRouterDefinition } from "./openrouter/index.js";
import { PlanetScaleDefinition } from "./planetscale/server.js";
import { PostHogDefinition } from "./posthog/server.js";
import { RailwayDefinition } from "./railway/server.js";
import { createAgentRuntimeServerRegistry } from "./registry/agent-runtimes.server.js";
import { RenderDefinition } from "./render/index.js";
import { ResendDefinition } from "./resend/server.js";
import {
  E2BSandboxRuntimeDefinition,
  ModalSandboxRuntimeDefinition,
  OpenComputerSandboxRuntimeDefinition,
  TensorlakeSandboxRuntimeDefinition,
} from "./sandbox-runtimes/index.js";
import { SentryDefinition } from "./sentry/server.js";
import { SignozDefinition } from "./signoz/server.js";
import { SlackDefinition } from "./slack/index.js";
import { StripeDefinition } from "./stripe/server.js";
import { SupabaseDefinition } from "./supabase/server.js";
import { WasenderApiDefinition } from "./wasenderapi/server.js";
import { WhapiDefinition } from "./whapi/server.js";
import { ZaiDefinition } from "./zai/index.js";

export * from "./agentmail/server.js";
export * from "./anthropic/index.js";
export * from "./aws/server.js";
export * from "./bugsnag/server.js";
export * from "./cloudflare/server.js";
export * from "./datadog/index.js";
export * from "./deepseek/index.js";
export * from "./egress-credential-resolver.server.js";
export * from "./egress-request-middleware.server.js";
export * from "./egress-telemetry.server.js";
export * from "./expo/server.js";
export * from "./fireworks/index.js";
export * from "./gcp/server.js";
export * from "./google-workspace/server.js";
export * from "./jira/index.js";
export * from "./github/index.js";
export * from "./github/shared/identity-linking.server.js";
export * from "./inception/index.js";
export * from "./kimi/index.js";
export * from "./linear/index.js";
export * from "./minimax/index.js";
export * from "./notion/server.js";
export * from "./openai/index.js";
export * from "./opencode/index.js";
export * from "./openrouter/index.js";
export * from "./planetscale/server.js";
export * from "./posthog/server.js";
export * from "./railway/server.js";
export * from "./render/index.js";
export * from "./resend/server.js";
export * from "./sandbox-runtimes/index.js";
export * from "./sentry/server.js";
export * from "./signoz/server.js";
export * from "./slack/index.js";
export * from "./stripe/server.js";
export * from "./supabase/server.js";
export * from "./wasenderapi/server.js";
export * from "./whapi/server.js";
export * from "./zai/index.js";
export * from "./forms/index.js";
export * from "./agent-runtimes/provider-selection.js";
export * from "./capability-catalog.js";
export * from "./registry/agent-runtimes.js";
export * from "./registry/agent-runtimes.server.js";
export * from "./shared/remote-mcp-server-catalog/index.js";
export * from "./shared/webhook-callback-url.server.js";

const RegisteredIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  AgentMailDefinition,
  AnthropicDefinition,
  AwsDefinition,
  BugSnagDefinition,
  CloudflareDefinition,
  DatadogDefinition,
  DeepSeekDefinition,
  ExpoDefinition,
  FireworksDefinition,
  GcpDefinition,
  GoogleWorkspaceDefinition,
  InceptionDefinition,
  JiraDefinition,
  KimiDefinition,
  GitHubCloudDefinition,
  GitHubEnterpriseServerDefinition,
  LinearDefinition,
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

export function createDefinitionsBundle(): IntegrationDefinitionsBundle {
  return {
    integrationRegistry: createIntegrationRegistry(),
    agentRuntimeRegistry: createAgentRuntimeServerRegistry(),
  };
}

export function resolveIntegrationEgressRequestMiddleware(input: {
  familyId: string;
  variantId: string;
  middlewareId: string;
}): IntegrationEgressRequestMiddleware | undefined {
  const definition = createIntegrationRegistry().getDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });

  return resolveDefinitionEgressRequestMiddleware(definition, input.middlewareId);
}

export function resolveIntegrationEgressCredentialResolver(input: {
  familyId: string;
  variantId: string;
  selection: IntegrationEgressCredentialResolverSelectionInput;
}): Promise<EgressCredentialResolverRef> | EgressCredentialResolverRef {
  const definition = createIntegrationRegistry().getDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });

  return resolveDefinitionEgressCredentialResolver({
    definition,
    selection: input.selection,
  });
}
