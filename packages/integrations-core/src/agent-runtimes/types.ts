import type { z } from "zod";

import type { AgentConversationProvider } from "../agent/conversation-provider.js";
import type { AgentProviderAccess } from "../capabilities/index.js";
import type {
  CompileBindingRefs,
  CompileBindingWorkspaceSource,
  EgressCredentialRoute,
  IntegrationConfigSchema,
  IntegrationMcpConfig,
  IntegrationFormDefinition,
  ResolvedIntegrationMcpServer,
  RuntimeArtifactSpec,
  RuntimeClient,
} from "../types/index.js";

export type AgentPtyLaunchArgument =
  | {
      kind: "literal";
      value: string;
    }
  | {
      kind: "threadId";
    };

export type AgentPtyLaunchTemplate = {
  ptySessionId: string;
  cols: number;
  rows: number;
  cwd?: string;
  command: string;
  args: readonly AgentPtyLaunchArgument[];
};

export type AgentPtyLaunchSpec = {
  runtimeId: string;
  displayName: string;
  newLaunch: AgentPtyLaunchTemplate;
  resumeLaunch: AgentPtyLaunchTemplate;
};

export type CompileAgentRuntimeInput<TRuntimeConfig = Record<string, unknown>> = {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  bindingId: string;
  connectionId: string;
  runtimeId: string;
  runtimeConfig: TRuntimeConfig;
  providerAccess: AgentProviderAccess;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
  refs: CompileBindingRefs;
};

export type CompileAgentRuntimeRenderRuntimeClientsInput = {
  /**
   * All compiled egress routes in the sandbox profile version. Runtime definitions
   * can derive local compatibility config from this view, but gateway egress
   * remains the source of truth for proxy policy.
   */
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  /**
   * The subset of egress routes emitted by the binding that owns this runtime.
   */
  bindingEgressRoutes: ReadonlyArray<EgressCredentialRoute>;
};

export type CompileAgentRuntimeResult = {
  artifacts?: ReadonlyArray<RuntimeArtifactSpec>;
  runtimeClients: ReadonlyArray<RuntimeClient>;
  renderRuntimeClients?: (
    input: CompileAgentRuntimeRenderRuntimeClientsInput,
  ) => ReadonlyArray<RuntimeClient>;
  workspaceSources?: ReadonlyArray<CompileBindingWorkspaceSource>;
  agentRuntimes: ReadonlyArray<{
    runtimeId: string;
    runtimeKey: string;
    clientId: string;
    endpointKey: string;
    ptyLaunch: AgentPtyLaunchSpec;
  }>;
};

export type AgentRuntimeDefinition<
  TRuntimeConfigSchema extends IntegrationConfigSchema<unknown> = IntegrationConfigSchema<
    Record<string, unknown>
  >,
> = {
  runtimeId: string;
  displayName: string;
  configSchema: TRuntimeConfigSchema;
  configForm?: IntegrationFormDefinition;
  compileRuntime(
    input: CompileAgentRuntimeInput<z.output<TRuntimeConfigSchema>>,
  ): CompileAgentRuntimeResult;
  createConversationProvider?(): AgentConversationProvider;
  materializeMcpConfig?(): ReadonlyArray<IntegrationMcpConfig>;
};

export type AnyAgentRuntimeDefinition = AgentRuntimeDefinition<IntegrationConfigSchema<unknown>>;

export type AgentRuntimeLocator = {
  runtimeId: string;
};

export interface AgentRuntimeReader {
  getRuntime(input: AgentRuntimeLocator): AnyAgentRuntimeDefinition | undefined;
}

export interface AgentRuntimeResolver extends AgentRuntimeReader {
  getRuntimeOrThrow(input: AgentRuntimeLocator): AnyAgentRuntimeDefinition;
}
