import { quote } from "shell-quote";

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
  type CompiledBindingResult,
  type CompiledRuntimeArtifactSpec,
  type IntegrationBindingMcpServer,
  type IntegrationMcpDefinitionValue,
  type IntegrationMcpServer,
  type IntegrationMcpValue,
  type ResolvedIntegrationMcpServer,
  type CompiledRuntimePlan,
  type RuntimeArtifactCommand,
  type RuntimeArtifactGithubReleaseInstallInput,
  type RuntimeArtifactLifecycleBuilder,
  type RuntimeArtifactRefs,
  type RuntimeArtifactSpec,
  type SandboxPathRefs,
} from "../types/index.js";
import { validateCompiledBindingResults } from "../validation/index.js";

const SandboxPaths: SandboxPathRefs = {
  userHomeDir: "/home/sandbox",
  userProjectsDir: "/home/sandbox/projects",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/var/lib/mistle/bin",
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

function renderInstallLatestGithubReleaseBinaryScript(
  input: RuntimeArtifactGithubReleaseInstallInput,
): string {
  const x86AssetFormat = input.assets.x86_64.format ?? "tar.gz";
  const aarch64AssetFormat = input.assets.aarch64.format ?? "tar.gz";

  return [
    'arch="$(uname -m)"',
    "repo=" + quote([input.repository]),
    "install_path=" + quote([input.installPath]),
    'case "$arch" in',
    "  x86_64)",
    `    asset_name=${quote([input.assets.x86_64.fileName])}`,
    `    binary_path=${quote([input.assets.x86_64.binaryPath])}`,
    `    asset_format=${quote([x86AssetFormat])}`,
    "    ;;",
    "  aarch64|arm64)",
    `    asset_name=${quote([input.assets.aarch64.fileName])}`,
    `    binary_path=${quote([input.assets.aarch64.binaryPath])}`,
    `    asset_format=${quote([aarch64AssetFormat])}`,
    "    ;;",
    "  *)",
    '    echo "Unsupported architecture: $arch" >&2',
    "    exit 1",
    "    ;;",
    "esac",
    "",
    'temp_dir="$(mktemp -d)"',
    "trap 'rm -rf \"$temp_dir\"' EXIT",
    "",
    'curl --noproxy "*" -fsSL "https://github.com/$repo/releases/latest/download/$asset_name" -o "$temp_dir/artifact"',
    'case "$asset_format" in',
    "  tar.gz)",
    '    tar -xzf "$temp_dir/artifact" -C "$temp_dir"',
    '    install -m 0755 "$temp_dir/$binary_path" "$install_path"',
    "    ;;",
    "  binary)",
    '    install -m 0755 "$temp_dir/artifact" "$install_path"',
    "    ;;",
    "  *)",
    '    echo "Unsupported asset format: $asset_format" >&2',
    "    exit 1",
    "    ;;",
    "esac",
  ].join("\n");
}

function createRuntimeArtifactRefs(input: {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  targetKey: string;
  bindingId: string;
}): RuntimeArtifactRefs {
  const exec = (execInput: {
    args: ReadonlyArray<string>;
    env?: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
  }): RuntimeArtifactCommand => {
    return {
      args: [...execInput.args],
      ...(execInput.env === undefined ? {} : { env: execInput.env }),
      ...(execInput.cwd === undefined ? {} : { cwd: execInput.cwd }),
      ...(execInput.timeoutMs === undefined ? {} : { timeoutMs: execInput.timeoutMs }),
    };
  };

  return {
    command: {
      exec,
    },
    sandboxPaths: SandboxPaths,
    artifactBinPath,
    mise: {
      install: (installInput) =>
        exec({
          args: [
            "mise",
            "install",
            ...(installInput.force === true ? ["--force"] : []),
            ...installInput.tools,
          ],
          ...(installInput.timeoutMs === undefined ? {} : { timeoutMs: installInput.timeoutMs }),
        }),
    },
    githubReleases: {
      installLatestBinary: (installInput) =>
        exec({
          args: ["sh", "-euc", renderInstallLatestGithubReleaseBinaryScript(installInput)],
          ...(installInput.timeoutMs === undefined ? {} : { timeoutMs: installInput.timeoutMs }),
        }),
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
  | ReadonlyArray<RuntimeArtifactCommand>
  | RuntimeArtifactLifecycleBuilder;

function resolveLifecycleHook(input: {
  artifactKey: string;
  hookName: "install" | "update" | "remove";
  hook: RuntimeArtifactLifecycleHook | undefined;
  refs: RuntimeArtifactRefs;
}): ReadonlyArray<RuntimeArtifactCommand> | undefined {
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

    const update = resolveLifecycleHook({
      artifactKey: artifact.artifactKey,
      hookName: "update",
      hook: artifact.lifecycle.update,
      refs,
    });
    const remove = resolveLifecycleHook({
      artifactKey: artifact.artifactKey,
      hookName: "remove",
      hook: artifact.lifecycle.remove,
      refs,
    });
    if (remove === undefined) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${artifact.artifactKey}' must define remove commands.`,
      );
    }

    return {
      artifactKey: artifact.artifactKey,
      name: artifact.name,
      ...(artifact.description === undefined ? {} : { description: artifact.description }),
      ...(artifact.env === undefined ? {} : { env: { ...artifact.env } }),
      lifecycle: {
        install,
        ...(update === undefined ? {} : { update }),
        remove,
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
  compiledBindingResult: CompiledBindingResult;
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
      const source = {
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
    if (left.source.bindingId !== right.source.bindingId) {
      return left.source.bindingId.localeCompare(right.source.bindingId);
    }

    return left.server.serverId.localeCompare(right.server.serverId);
  });
}

function applyMcpMappings(input: {
  preparedBindings: ReadonlyArray<PreparedBindingContext>;
  mcpServers: ReadonlyArray<ResolvedIntegrationMcpServer>;
}): ReadonlyArray<CompiledBindingResult> {
  return input.preparedBindings.map((preparedBinding) => {
    const mcpConfig = preparedBinding.definition.mcpConfig;

    if (mcpConfig === undefined) {
      return preparedBinding.compiledBindingResult;
    }

    return {
      ...preparedBinding.compiledBindingResult,
      runtimeClients: applyMcpConfigToRuntimeClients({
        runtimeClients: preparedBinding.compiledBindingResult.runtimeClients,
        mcpConfig,
        mcpServers: input.mcpServers,
      }),
    };
  });
}

type CompileBindingsInput = {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  registry: CompileRuntimePlanInput["registry"];
  bindings: ReadonlyArray<CompileRuntimePlanBindingInput>;
  enforceRuntimeEligibility: boolean;
};

function compileBindings(input: CompileBindingsInput): ReadonlyArray<CompiledBindingResult> {
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

    const definition = input.registry.getDefinitionOrThrow({
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

    const compileBindingResult: CompileBindingResult =
      definition.compileBinding(compileBindingInput);

    const compiledBindingResult: CompiledBindingResult = {
      egressRoutes: compileBindingResult.egressRoutes.map((route, routeIndex) => ({
        ...route,
        egressRuleId: resolveEgressRuleId({
          bindingId: bindingInput.binding.id,
          routeIndex,
        }),
        bindingId: bindingInput.binding.id,
      })),
      artifacts: resolveRuntimeArtifacts({
        artifacts: compileBindingResult.artifacts,
        organizationId: input.organizationId,
        sandboxProfileId: input.sandboxProfileId,
        version: input.version,
        targetKey: bindingInput.targetKey,
        bindingId: bindingInput.binding.id,
      }),
      runtimeClients: compileBindingResult.runtimeClients,
      workspaceSources: compileBindingResult.workspaceSources ?? [],
      agentRuntimes:
        compileBindingResult.agentRuntimes?.map((agentRuntime) => ({
          ...agentRuntime,
          bindingId: bindingInput.binding.id,
        })) ?? [],
    };

    preparedBindings.push({
      definition,
      compileBindingInput,
      compiledBindingResult,
    });
  }

  const resolvedMcpServers = collectResolvedMcpServers({
    preparedBindings,
  });

  return applyMcpMappings({
    preparedBindings,
    mcpServers: resolvedMcpServers,
  });
}

export function compileRuntimePlan(input: CompileRuntimePlanInput): CompiledRuntimePlan {
  const compiledBindingResults = compileBindings({
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    registry: input.registry,
    bindings: input.bindings,
    enforceRuntimeEligibility: true,
  });

  validateCompiledBindingResults({
    compiledBindingResults,
  });

  const previousCompiledBindingResults =
    input.previousBindings === undefined
      ? []
      : compileBindings({
          organizationId: input.organizationId,
          sandboxProfileId: input.sandboxProfileId,
          version: input.version - 1,
          registry: input.registry,
          bindings: input.previousBindings,
          enforceRuntimeEligibility: false,
        });

  return assembleCompiledRuntimePlan({
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image: input.image,
    compiledBindingResults,
    previousCompiledBindingResults,
  });
}
