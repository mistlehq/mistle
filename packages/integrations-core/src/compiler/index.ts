import { runDefinitionBindingWriteValidation } from "../binding-validation/index.js";
import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import { applyMcpConfigToRuntimeClients } from "../mcp-config/index.js";
import { assembleCompiledRuntimePlan } from "../runtime-plan/index.js";
import {
  type AnyIntegrationDefinition,
  type CompileBindingInput,
  IntegrationConnectionStatuses,
  IntegrationMcpTransports,
  type CompileRuntimePlanBindingInput,
  type CompileBindingResult,
  type CompileRuntimePlanInput,
  type CompiledRuntimePlanFragment,
  type CompiledRuntimeArtifactSpec,
  type IntegrationBindingMcpServer,
  type IntegrationBindingMcpServerSource,
  type IntegrationMcpDefinitionValue,
  type IntegrationMcpServer,
  type IntegrationMcpValue,
  type ResolvedIntegrationMcpServer,
  type CompiledRuntimePlan,
  type RuntimeArtifactGitHubReleaseInstallHelperInput,
  type RuntimeArtifactInstallStep,
  type RuntimeArtifactLifecycleBuilder,
  type RuntimeArtifactRefs,
  type RuntimeExecCommand,
  type RuntimeArtifactSpec,
  type RuntimeClient,
  type SandboxPathRefs,
} from "../types/index.js";
import { validateCompiledRuntimePlanFragments } from "../validation/index.js";

export const DefaultSandboxWorkspaceDir = "/root";

const SandboxPaths: SandboxPathRefs = {
  userHomeDir: "/root",
  workspaceDir: DefaultSandboxWorkspaceDir,
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
};

function artifactBinPath(name: string): string {
  return `${SandboxPaths.runtimeArtifactBinDir}/${name}`;
}

function resolveEgressRuleId(input: { bindingId: string; routeIndex: number }): string {
  if (input.routeIndex === 0) {
    return `egress_rule_${input.bindingId}`;
  }

  return `egress_rule_${input.bindingId}_${input.routeIndex + 1}`;
}

function createGitHubReleaseInstallStep(
  input: RuntimeArtifactGitHubReleaseInstallHelperInput,
): RuntimeArtifactInstallStep {
  return {
    op: "github_release_install",
    repository: input.repository,
    release:
      input.release.kind === "latest"
        ? { kind: "latest" }
        : input.release.match === "exact"
          ? {
              kind: "tag",
              match: "exact",
              tag: input.release.tag,
            }
          : {
              kind: "tag",
              match: "latest_matching_prefix",
              prefix: input.release.prefix,
            },
    asset:
      input.asset.kind === "exact"
        ? { ...input.asset }
        : {
            kind: "by_arch",
            x86_64: { ...input.asset.x86_64 },
            aarch64: { ...input.asset.aarch64 },
          },
    installPath: input.installPath,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

function createRuntimeArtifactRefs(input: {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  targetKey: string;
  bindingId: string;
}): RuntimeArtifactRefs {
  const createExecCommand = (execInput: {
    args: ReadonlyArray<string>;
    env?: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
  }): RuntimeExecCommand => {
    return {
      args: [...execInput.args],
      ...(execInput.env === undefined ? {} : { env: execInput.env }),
      ...(execInput.cwd === undefined ? {} : { cwd: execInput.cwd }),
      ...(execInput.timeoutMs === undefined ? {} : { timeoutMs: execInput.timeoutMs }),
    };
  };

  const exec = (execInput: RuntimeExecCommand): RuntimeArtifactInstallStep => {
    return {
      op: "exec",
      command: createExecCommand(execInput),
    };
  };

  return {
    command: {
      exec,
    },
    sandboxPaths: SandboxPaths,
    artifactBinPath,
    mise: {
      install: (installInput) => ({
        op: "mise_install",
        tools: [...installInput.tools],
        ...(installInput.force === undefined ? {} : { force: installInput.force }),
        ...(installInput.timeoutMs === undefined ? {} : { timeoutMs: installInput.timeoutMs }),
      }),
    },
    githubReleases: {
      install: (installInput) => createGitHubReleaseInstallStep(installInput),
    },
    compileContext: {
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      version: input.version,
      targetKey: input.targetKey,
      bindingId: input.bindingId,
    },
  };
}

type RuntimeArtifactLifecycleHook =
  | ReadonlyArray<RuntimeArtifactInstallStep>
  | RuntimeArtifactLifecycleBuilder;

function resolveLifecycleHook(input: {
  artifactKey: string;
  hookName: "install" | "remove";
  hook: RuntimeArtifactLifecycleHook | undefined;
  refs: RuntimeArtifactRefs;
}): ReadonlyArray<RuntimeArtifactInstallStep> | undefined {
  if (input.hook === undefined) {
    return undefined;
  }

  try {
    if (typeof input.hook === "function") {
      return input.hook({ refs: input.refs });
    }

    return input.hook;
  } catch (error) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.ARTIFACT_CONFLICT,
      `Failed resolving artifact lifecycle hook '${input.hookName}' for '${input.artifactKey}'.`,
      { cause: error },
    );
  }
}

function compileRuntimeArtifactInstallEntry(
  input: RuntimeArtifactInstallStep,
): CompiledRuntimeArtifactSpec["lifecycle"]["install"][number] {
  return input;
}

function resolveRuntimeArtifacts(input: {
  artifacts: ReadonlyArray<RuntimeArtifactSpec>;
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  targetKey: string;
  bindingId: string;
}): ReadonlyArray<CompiledRuntimeArtifactSpec> {
  const refs = createRuntimeArtifactRefs({
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    targetKey: input.targetKey,
    bindingId: input.bindingId,
  });

  return input.artifacts.map((artifact) => {
    const install = resolveLifecycleHook({
      artifactKey: artifact.artifactKey,
      hookName: "install",
      hook: artifact.lifecycle.install,
      refs,
    });

    if (install === undefined) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${artifact.artifactKey}' must define install commands.`,
      );
    }

    return {
      artifactKey: artifact.artifactKey,
      name: artifact.name,
      ...(artifact.description === undefined ? {} : { description: artifact.description }),
      ...(artifact.env === undefined ? {} : { env: { ...artifact.env } }),
      lifecycle: {
        install: install.map((installEntry) => compileRuntimeArtifactInstallEntry(installEntry)),
      },
    };
  });
}

function resolveMcpValue(input: { value: IntegrationMcpValue }): string {
  return input.value;
}

function resolveMcpRecord(input: {
  value: Readonly<Record<string, IntegrationMcpValue>> | undefined;
}): Readonly<Record<string, string>> | undefined {
  if (input.value === undefined) {
    return undefined;
  }

  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(input.value)) {
    resolved[key] = resolveMcpValue({
      value,
    });
  }

  return resolved;
}

function normalizeMcpDefinitionValue(
  input: IntegrationMcpDefinitionValue,
): ReadonlyArray<IntegrationMcpServer> {
  if (isIntegrationMcpServerArray(input)) {
    return [...input];
  }

  return [input];
}

function isIntegrationMcpServerArray(
  input: IntegrationMcpDefinitionValue,
): input is ReadonlyArray<IntegrationMcpServer> {
  return Array.isArray(input);
}

function validateMcpServerShape(input: { server: IntegrationBindingMcpServer }): void {
  const { source, server } = input.server;

  if (server.serverId.trim().length === 0) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.MCP_CONFLICT,
      `Binding '${source.bindingId}' declared an MCP server with an empty serverId.`,
    );
  }

  if (server.serverName.trim().length === 0) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.MCP_CONFLICT,
      `Binding '${source.bindingId}' declared an MCP server with an empty serverName.`,
    );
  }

  if (server.transport === IntegrationMcpTransports.STDIO) {
    if (server.command === undefined || server.command.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.MCP_CONFLICT,
        `MCP server '${server.serverName}' on binding '${source.bindingId}' must define a command for stdio transport.`,
      );
    }

    return;
  }

  if (
    server.url === undefined ||
    (typeof server.url === "string" && server.url.trim().length === 0)
  ) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.MCP_CONFLICT,
      `MCP server '${server.serverName}' on binding '${source.bindingId}' must define a url for '${server.transport}' transport.`,
    );
  }
}

type PreparedBindingContext = {
  definition: AnyIntegrationDefinition;
  compileBindingInput: CompileBindingInput<unknown, unknown, unknown>;
  compiledRuntimePlanFragment: CompiledRuntimePlanFragment;
};

function collectResolvedMcpServers(input: {
  preparedBindings: ReadonlyArray<PreparedBindingContext>;
}): ReadonlyArray<ResolvedIntegrationMcpServer> {
  const serverIds = new Set<string>();
  const serverNames = new Set<string>();
  const resolvedServers: ResolvedIntegrationMcpServer[] = [];

  for (const preparedBinding of input.preparedBindings) {
    const mcpDefinition = preparedBinding.definition.mcp;
    if (mcpDefinition === undefined) {
      continue;
    }

    const rawServers = normalizeMcpDefinitionValue(
      typeof mcpDefinition === "function"
        ? mcpDefinition(preparedBinding.compileBindingInput)
        : mcpDefinition,
    );

    for (const server of rawServers) {
      const source: IntegrationBindingMcpServerSource = {
        kind: "integration",
        bindingId: preparedBinding.compileBindingInput.binding.id,
        connectionId: preparedBinding.compileBindingInput.connection.id,
        targetKey: preparedBinding.compileBindingInput.targetKey,
        familyId: preparedBinding.compileBindingInput.target.familyId,
        variantId: preparedBinding.compileBindingInput.target.variantId,
      };
      const integrationBindingMcpServer: IntegrationBindingMcpServer = {
        source,
        server,
      };
      const serverKey = `${source.bindingId}:${server.serverId}`;

      if (serverIds.has(serverKey)) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.MCP_CONFLICT,
          `Binding '${source.bindingId}' declared duplicate MCP server id '${server.serverId}'.`,
        );
      }
      serverIds.add(serverKey);

      if (serverNames.has(server.serverName)) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.MCP_CONFLICT,
          `Duplicate MCP server name '${server.serverName}' detected across sandbox profile bindings.`,
        );
      }
      serverNames.add(server.serverName);

      validateMcpServerShape({
        server: integrationBindingMcpServer,
      });

      const resolvedServer: ResolvedIntegrationMcpServer["server"] = {
        serverId: server.serverId,
        serverName: server.serverName,
        transport: server.transport,
      };

      if (server.description !== undefined) {
        resolvedServer.description = server.description;
      }

      if (server.url !== undefined) {
        resolvedServer.url = resolveMcpValue({
          value: server.url,
        });
      }

      if (server.command !== undefined) {
        resolvedServer.command = server.command;
      }

      if (server.args !== undefined) {
        resolvedServer.args = server.args;
      }

      if (server.env !== undefined) {
        const resolvedEnv = resolveMcpRecord({
          value: server.env,
        });

        if (resolvedEnv !== undefined) {
          resolvedServer.env = resolvedEnv;
        }
      }

      if (server.httpHeaders !== undefined) {
        const resolvedHttpHeaders = resolveMcpRecord({
          value: server.httpHeaders,
        });

        if (resolvedHttpHeaders !== undefined) {
          resolvedServer.httpHeaders = resolvedHttpHeaders;
        }
      }

      resolvedServers.push({
        source,
        server: resolvedServer,
      });
    }
  }

  return [...resolvedServers].sort((left, right) => {
    const leftSortKey =
      left.source.kind === "integration" ? left.source.bindingId : left.source.kind;
    const rightSortKey =
      right.source.kind === "integration" ? right.source.bindingId : right.source.kind;

    if (leftSortKey !== rightSortKey) {
      return leftSortKey.localeCompare(rightSortKey);
    }

    return left.server.serverId.localeCompare(right.server.serverId);
  });
}

function applyMcpMappings(input: {
  definitions: CompileBindingsInput["definitions"];
  preparedBindings: ReadonlyArray<PreparedBindingContext>;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): ReadonlyArray<CompiledRuntimePlanFragment> {
  return input.preparedBindings.map((preparedBinding) => {
    const providerOwnedMcpConfig =
      preparedBinding.definition.kind === "agent"
        ? undefined
        : preparedBinding.definition.mcpConfig;

    if (providerOwnedMcpConfig === undefined) {
      return preparedBinding.compiledRuntimePlanFragment;
    }

    return {
      ...preparedBinding.compiledRuntimePlanFragment,
      runtimeClients: applyMcpConfigToRuntimeClients({
        runtimeClients: preparedBinding.compiledRuntimePlanFragment.runtimeClients,
        mcpConfig: providerOwnedMcpConfig,
        mcpServers: input.mcpServers,
      }),
    };
  });
}

function compileBindingResultToCompiledRuntimePlanFragment(input: {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  targetKey: string;
  bindingId: string;
  familyId: string;
  variantId: string;
  compileBindingResult: CompileBindingResult;
}): CompiledRuntimePlanFragment {
  return {
    egressRoutes: input.compileBindingResult.egressRoutes.map((route, routeIndex) => ({
      ...route,
      egressRuleId: resolveEgressRuleId({
        bindingId: input.bindingId,
        routeIndex,
      }),
      bindingId: input.bindingId,
      familyId: input.familyId,
      variantId: input.variantId,
    })),
    artifacts: resolveRuntimeArtifacts({
      artifacts: input.compileBindingResult.artifacts,
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      version: input.version,
      targetKey: input.targetKey,
      bindingId: input.bindingId,
    }),
    runtimeClients: input.compileBindingResult.runtimeClients,
    workspaceSources: input.compileBindingResult.workspaceSources ?? [],
    agentRuntimes: input.compileBindingResult.agentRuntimes ?? [],
  };
}

type CompileBindingsInput = {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  definitions: CompileRuntimePlanInput["definitions"];
  bindings: ReadonlyArray<CompileRuntimePlanBindingInput>;
  enforceRuntimeEligibility: boolean;
};

type CompileBindingsResult = {
  compiledRuntimePlanFragments: ReadonlyArray<CompiledRuntimePlanFragment>;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
};

function applyAgentRuntimeMcpMappings(input: {
  runtimeId: string;
  runtimeClients: ReadonlyArray<RuntimeClient>;
  runtimeDefinition: NonNullable<
    ReturnType<CompileRuntimePlanInput["definitions"]["agentRuntimeRegistry"]["getRuntime"]>
  >;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): ReadonlyArray<RuntimeClient> {
  let runtimeClients = input.runtimeClients;

  for (const mcpConfig of input.runtimeDefinition.materializeMcpConfig?.() ?? []) {
    const targetClient = runtimeClients.find(
      (runtimeClient) => runtimeClient.clientId === mcpConfig.clientId,
    );
    const targetFile = targetClient?.setup.files.find((file) => file.fileId === mcpConfig.fileId);
    if (targetClient === undefined || targetFile === undefined) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.AGENT_RUNTIME_MCP_TARGET_CLIENT_MISSING,
        `Agent runtime '${input.runtimeId}' MCP config target '${mcpConfig.clientId}::${mcpConfig.fileId}' was not found.`,
      );
    }

    runtimeClients = applyMcpConfigToRuntimeClients({
      runtimeClients,
      mcpConfig,
      mcpServers: input.mcpServers,
    });
  }

  return runtimeClients;
}

function compileProfileAgentRuntimeFragment(input: {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  definitions: CompileRuntimePlanInput["definitions"];
  agentRuntimeId: string;
  egressRoutes: ReadonlyArray<CompiledRuntimePlanFragment["egressRoutes"][number]>;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
  mergeRuntimeSetupFiles?: boolean;
}): CompiledRuntimePlanFragment {
  const runtimeDefinition = input.definitions.agentRuntimeRegistry.getRuntime({
    runtimeId: input.agentRuntimeId,
  });

  if (runtimeDefinition === undefined) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.AGENT_RUNTIME_NOT_FOUND,
      `Sandbox profile references unknown agent runtime '${input.agentRuntimeId}'.`,
    );
  }

  let parsedRuntimeConfig: unknown;
  try {
    parsedRuntimeConfig = runtimeDefinition.configSchema.parse({});
  } catch (error) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.INVALID_AGENT_RUNTIME_CONFIG,
      `Sandbox profile has invalid config for agent runtime '${input.agentRuntimeId}'.`,
      { cause: error },
    );
  }

  const runtimeRefs = {
    sandboxPaths: SandboxPaths,
    artifactBinPath,
  };
  const compileAgentRuntimeResult = runtimeDefinition.compileRuntime({
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    runtimeId: input.agentRuntimeId,
    runtimeConfig: parsedRuntimeConfig,
    mcpServers: input.mcpServers,
    ...(input.mergeRuntimeSetupFiles === undefined
      ? {}
      : { mergeRuntimeSetupFiles: input.mergeRuntimeSetupFiles }),
    refs: runtimeRefs,
  });
  let renderedRuntimeClients: ReadonlyArray<RuntimeClient>;
  try {
    renderedRuntimeClients =
      compileAgentRuntimeResult.renderRuntimeClients?.({
        egressRoutes: input.egressRoutes,
      }) ??
      compileAgentRuntimeResult.runtimeClients ??
      [];
  } catch (error) {
    const causeMessage = error instanceof Error ? ` ${error.message}` : "";
    throw new IntegrationCompilerError(
      CompilerErrorCodes.INVALID_AGENT_RUNTIME_CONFIG,
      `Agent runtime '${input.agentRuntimeId}' failed to render runtime clients.${causeMessage}`,
      { cause: error },
    );
  }

  return {
    egressRoutes: [],
    artifacts: resolveRuntimeArtifacts({
      artifacts: compileAgentRuntimeResult.artifacts ?? [],
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      version: input.version,
      targetKey: "agent-runtime",
      bindingId: `agent-runtime-${input.agentRuntimeId}`,
    }),
    runtimeClients: applyAgentRuntimeMcpMappings({
      runtimeId: input.agentRuntimeId,
      runtimeClients: renderedRuntimeClients,
      runtimeDefinition,
      mcpServers: input.mcpServers,
    }),
    workspaceSources: compileAgentRuntimeResult.workspaceSources ?? [],
    agentRuntimes: compileAgentRuntimeResult.agentRuntimes,
  };
}

function compileBindings(input: CompileBindingsInput): CompileBindingsResult {
  const preparedBindings: PreparedBindingContext[] = [];

  for (const bindingInput of input.bindings) {
    if (bindingInput.connection.id !== bindingInput.binding.connectionId) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.CONNECTION_MISMATCH,
        `Binding '${bindingInput.binding.id}' references connection '${bindingInput.binding.connectionId}' but resolved connection was '${bindingInput.connection.id}'.`,
      );
    }

    if (input.enforceRuntimeEligibility && !bindingInput.target.enabled) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.TARGET_DISABLED,
        `Target '${bindingInput.targetKey}' is disabled.`,
      );
    }

    if (
      input.enforceRuntimeEligibility &&
      bindingInput.connection.status !== IntegrationConnectionStatuses.ACTIVE
    ) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.CONNECTION_NOT_ACTIVE,
        `Connection '${bindingInput.connection.id}' is not active.`,
      );
    }

    const definition = input.definitions.integrationRegistry.getDefinitionOrThrow({
      familyId: bindingInput.target.familyId,
      variantId: bindingInput.target.variantId,
    });

    if (definition.kind !== bindingInput.binding.kind) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.KIND_MISMATCH,
        `Binding '${bindingInput.binding.id}' has kind '${bindingInput.binding.kind}' but definition '${definition.familyId}::${definition.variantId}' has kind '${definition.kind}'.`,
      );
    }

    let parsedTargetConfig: ReturnType<typeof definition.targetConfigSchema.parse>;
    try {
      parsedTargetConfig = definition.targetConfigSchema.parse(bindingInput.target.config);
    } catch (error) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.INVALID_TARGET_CONFIG,
        `Target config for '${bindingInput.targetKey}' did not satisfy '${definition.familyId}::${definition.variantId}' schema.`,
        { cause: error },
      );
    }

    let parsedTargetSecrets: ReturnType<typeof definition.targetSecretSchema.parse>;
    try {
      parsedTargetSecrets = definition.targetSecretSchema.parse(bindingInput.target.secrets);
    } catch (error) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.INVALID_TARGET_SECRETS,
        `Target secrets for '${bindingInput.targetKey}' did not satisfy '${definition.familyId}::${definition.variantId}' schema.`,
        { cause: error },
      );
    }

    let parsedBindingConfig: ReturnType<typeof definition.bindingConfigSchema.parse>;
    try {
      parsedBindingConfig = definition.bindingConfigSchema.parse(bindingInput.binding.config);
    } catch (error) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.INVALID_BINDING_CONFIG,
        `Binding config for '${bindingInput.binding.id}' did not satisfy '${definition.familyId}::${definition.variantId}' schema.`,
        { cause: error },
      );
    }

    const bindingWriteValidation = runDefinitionBindingWriteValidation({
      definition,
      targetKey: bindingInput.targetKey,
      target: {
        familyId: bindingInput.target.familyId,
        variantId: bindingInput.target.variantId,
        config: bindingInput.target.config,
      },
      connection: {
        id: bindingInput.connection.id,
        config: bindingInput.connection.config,
      },
      binding: {
        kind: bindingInput.binding.kind,
        config: bindingInput.binding.config,
      },
      bindingIdOrDraftIndex: bindingInput.binding.id,
    });
    if (!bindingWriteValidation.ok) {
      const firstIssue = bindingWriteValidation.issues[0];
      const message = firstIssue?.safeMessage ?? "Binding contextual validation failed.";
      throw new IntegrationCompilerError(CompilerErrorCodes.INVALID_BINDING_CONFIG, message);
    }

    const compileBindingInput: CompileBindingInput<unknown, unknown, unknown> = {
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      version: input.version,
      targetKey: bindingInput.targetKey,
      target: {
        ...bindingInput.target,
        config: parsedTargetConfig,
        secrets: parsedTargetSecrets,
      },
      connection: bindingInput.connection,
      binding: {
        id: bindingInput.binding.id,
        kind: bindingInput.binding.kind,
        config: parsedBindingConfig,
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    };

    const compileBindingResult = definition.compileBinding(compileBindingInput);
    const compiledRuntimePlanFragment = compileBindingResultToCompiledRuntimePlanFragment({
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      version: input.version,
      targetKey: bindingInput.targetKey,
      bindingId: bindingInput.binding.id,
      familyId: bindingInput.target.familyId,
      variantId: bindingInput.target.variantId,
      compileBindingResult,
    });

    preparedBindings.push({
      definition,
      compileBindingInput,
      compiledRuntimePlanFragment,
    });
  }

  const resolvedMcpServers = collectResolvedMcpServers({
    preparedBindings,
  });

  return {
    compiledRuntimePlanFragments: applyMcpMappings({
      definitions: input.definitions,
      preparedBindings,
      mcpServers: resolvedMcpServers,
    }),
    mcpServers: resolvedMcpServers,
  };
}

export function compileRuntimePlan(input: CompileRuntimePlanInput): CompiledRuntimePlan {
  const compiledBindings = compileBindings({
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    definitions: input.definitions,
    bindings: input.bindings,
    enforceRuntimeEligibility: true,
  });
  const resolvedMcpServers = [...compiledBindings.mcpServers, ...(input.mcpServers ?? [])].sort(
    (left, right) => left.server.serverName.localeCompare(right.server.serverName),
  );
  const platformRuntimePlanFragment: CompiledRuntimePlanFragment = {
    egressRoutes: input.egressRoutes ?? [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
  const compiledBindingAndPlatformFragments = [
    ...compiledBindings.compiledRuntimePlanFragments,
    platformRuntimePlanFragment,
  ];
  const compiledRuntimePlanFragments = [
    ...compiledBindingAndPlatformFragments,
    compileProfileAgentRuntimeFragment({
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      version: input.version,
      definitions: input.definitions,
      agentRuntimeId: input.agentRuntimeId,
      egressRoutes: compiledBindingAndPlatformFragments.flatMap(
        (compiledRuntimePlanFragment) => compiledRuntimePlanFragment.egressRoutes,
      ),
      mcpServers: resolvedMcpServers,
      ...(input.mergeRuntimeSetupFiles === undefined
        ? {}
        : { mergeRuntimeSetupFiles: input.mergeRuntimeSetupFiles }),
    }),
  ];

  validateCompiledRuntimePlanFragments({
    compiledRuntimePlanFragments,
  });

  return assembleCompiledRuntimePlan({
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image: input.image,
    compiledRuntimePlanFragments,
  });
}
