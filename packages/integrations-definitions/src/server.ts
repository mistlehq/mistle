import {
  IntegrationRegistry,
  type IntegrationEgressRequestMiddleware,
  type EgressCredentialResolverRef,
  type IntegrationEgressCredentialResolverSelectionInput,
  type AnyIntegrationDefinition,
  type IntegrationDefinitionsBundle,
} from "@mistle/integrations-core";

import { AnthropicDefinition } from "./anthropic/index.js";
import { AwsDefinition } from "./aws/server.js";
import { DatadogDefinition } from "./datadog/index.js";
import { resolveDefinitionEgressCredentialResolver } from "./egress-credential-resolver.server.js";
import { resolveDefinitionEgressRequestMiddleware } from "./egress-request-middleware.server.js";
import { GitHubCloudDefinition, GitHubEnterpriseServerDefinition } from "./github/index.js";
import { JiraDefinition } from "./jira/index.js";
import { LinearDefinition } from "./linear/index.js";
import { OpenAiApiKeyDefinition } from "./openai/index.js";
import { OpenCodeGoDefinition } from "./opencode/index.js";
import { PlanetScaleDefinition } from "./planetscale/server.js";
import { createAgentRuntimeRegistry } from "./registry/agent-runtimes.js";
import { E2BSandboxRuntimeDefinition } from "./sandbox-runtimes/index.js";
import { SignozDefinition } from "./signoz/server.js";
import { SlackDefinition } from "./slack/index.js";

export * from "./anthropic/index.js";
export * from "./aws/server.js";
export * from "./datadog/index.js";
export * from "./egress-credential-resolver.server.js";
export * from "./egress-request-middleware.server.js";
export * from "./egress-telemetry.server.js";
export * from "./jira/index.js";
export * from "./github/index.js";
export * from "./github/shared/identity-linking.server.js";
export * from "./linear/index.js";
export * from "./openai/index.js";
export * from "./opencode/index.js";
export * from "./planetscale/server.js";
export * from "./sandbox-runtimes/index.js";
export * from "./signoz/server.js";
export * from "./slack/index.js";
export * from "./forms/index.js";
export * from "./agent-runtimes/provider-selection.js";
export * from "./registry/agent-runtimes.js";
export * from "./shared/webhook-callback-url.server.js";

const RegisteredIntegrationDefinitions: ReadonlyArray<AnyIntegrationDefinition> = [
  AnthropicDefinition,
  AwsDefinition,
  DatadogDefinition,
  JiraDefinition,
  GitHubCloudDefinition,
  GitHubEnterpriseServerDefinition,
  LinearDefinition,
  OpenAiApiKeyDefinition,
  OpenCodeGoDefinition,
  PlanetScaleDefinition,
  E2BSandboxRuntimeDefinition,
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
