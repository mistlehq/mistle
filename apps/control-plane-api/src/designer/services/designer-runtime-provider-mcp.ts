import type { ControlPlaneDatabase, IntegrationTarget } from "@mistle/db/control-plane";
import { IntegrationConnectionStatuses } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import {
  DesignerRuntimeAccessInstallModes,
  IntegrationMcpTransports,
  resolveRouteForRequest,
  runDefinitionBindingWriteValidation,
  type AnyIntegrationDefinition,
  type CompileBindingInput,
  type EgressCredentialRoute,
  type IntegrationMcpDefinitionValue,
  type IntegrationMcpServer,
  type IntegrationRegistry,
} from "@mistle/integrations-core";
import { z } from "zod";

import { resolveIntegrationTargetSecrets } from "../../lib/integration-target-secrets.js";
import type { ControlPlaneApiConfig } from "../../types.js";

const UnknownRecordSchema = z.record(z.string(), z.unknown());

type DesignerRuntimeProviderMcpContext = {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  integrationsConfig: ControlPlaneApiConfig["integrations"];
};

type DesignerRuntimeProviderMcpServerConfig = {
  serverName: string;
  transport: "streamable_http";
  url: string;
  httpHeaders: Record<string, string>;
};

type DesignerRuntimeProviderEgressRouteMatcher = {
  egressRuleId: string;
  hosts: readonly string[];
  pathPrefixes: readonly string[];
  methods?: readonly string[];
  designerRuntimeMcp: {
    integrationConnectionId: string;
    providerToolIds: readonly string[];
  };
};

export type DesignerRuntimeProviderMcpInstallPrepareResult = {
  status: "prepared";
  runtimeAction: {
    type: "codex_mcp_config_install_and_reload";
    runtimeClientId: "codex-cli";
    mcpServers: ReadonlyArray<DesignerRuntimeProviderMcpServerConfig>;
    egressRouteMatchers: ReadonlyArray<DesignerRuntimeProviderEgressRouteMatcher>;
  };
};

type DesignerRuntimeResolvedBinding = {
  definition: AnyIntegrationDefinition;
  compileBindingInput: CompileBindingInput<unknown, unknown, unknown>;
};

type DesignerRuntimeConnectionRecord = {
  id: string;
  organizationId: string;
  targetKey: string;
  status: string;
  externalSubjectId: string | null;
  config: Record<string, unknown> | null;
};

type DesignerRuntimeTargetRecord = Pick<
  IntegrationTarget,
  "targetKey" | "familyId" | "variantId" | "enabled" | "config" | "secrets"
>;

export async function prepareDesignerRuntimeProviderMcpInstall(
  ctx: DesignerRuntimeProviderMcpContext,
  input: {
    organizationId: string;
    designerSessionId: string;
    sandboxInstanceId: string;
    connectionId: string;
    toolIds: readonly string[];
  },
): Promise<DesignerRuntimeProviderMcpInstallPrepareResult> {
  await requireDesignerSession(ctx, {
    organizationId: input.organizationId,
    designerSessionId: input.designerSessionId,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  const resolvedBinding = await resolveDesignerRuntimeBinding(ctx, {
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    toolIds: input.toolIds,
  });
  const mcpServers = resolveRemoteMcpServers({
    compileBindingInput: resolvedBinding.compileBindingInput,
    definition: resolvedBinding.definition,
    connectionId: input.connectionId,
    toolIds: input.toolIds,
  });
  const compiledRoutes = compileDesignerRuntimeRoutes(resolvedBinding);
  const egressRouteMatchers = resolveRemoteMcpEgressRouteMatchers({
    connectionId: input.connectionId,
    compiledRoutes,
    mcpServers,
    toolIds: input.toolIds,
  });
  if (egressRouteMatchers.length === 0) {
    throw new BadRequestError(
      "DESIGNER_RUNTIME_MCP_EGRESS_ROUTE_UNAVAILABLE",
      "Designer runtime MCP installation did not resolve a sandbox-local egress route matcher for the prepared remote MCP server.",
    );
  }

  return {
    status: "prepared",
    runtimeAction: {
      type: "codex_mcp_config_install_and_reload",
      runtimeClientId: "codex-cli",
      mcpServers,
      egressRouteMatchers,
    },
  };
}

export async function prepareDesignerRuntimeProviderMcpInstallForSession(
  ctx: DesignerRuntimeProviderMcpContext,
  input: {
    organizationId: string;
    designerSessionId: string;
    connectionId: string;
    toolIds: readonly string[];
  },
): Promise<DesignerRuntimeProviderMcpInstallPrepareResult> {
  const designerSession = await requireDesignerSessionById(ctx, {
    organizationId: input.organizationId,
    designerSessionId: input.designerSessionId,
  });

  return prepareDesignerRuntimeProviderMcpInstall(ctx, {
    organizationId: input.organizationId,
    designerSessionId: input.designerSessionId,
    sandboxInstanceId: designerSession.sandboxInstanceId,
    connectionId: input.connectionId,
    toolIds: input.toolIds,
  });
}

export async function resolveDesignerRuntimeEgressRoute(
  ctx: DesignerRuntimeProviderMcpContext,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    integrationConnectionId: string;
    providerToolIds: readonly string[];
    targetUrl: string;
    method: string;
    transport: "http" | "websocket";
  },
): Promise<{ route: EgressCredentialRoute }> {
  await requireDesignerSandboxInstance(ctx, {
    organizationId: input.organizationId,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  const resolvedBinding = await resolveDesignerRuntimeBinding(ctx, {
    organizationId: input.organizationId,
    connectionId: input.integrationConnectionId,
    toolIds: input.providerToolIds,
  });
  const compiledRoutes = compileDesignerRuntimeRoutes(resolvedBinding);
  const targetUrl = new URL(input.targetUrl);
  const matchedRoute = resolveRouteForRequest({
    routes: compiledRoutes,
    request: {
      host: targetUrl.host,
      method: input.method,
      path: targetUrl.pathname,
    },
  });

  if (matchedRoute === undefined) {
    throw new BadRequestError(
      "DESIGNER_RUNTIME_EGRESS_ROUTE_UNMATCHED",
      "Designer runtime access did not resolve a provider egress route for the target request.",
    );
  }

  return { route: matchedRoute };
}

function compileDesignerRuntimeRoutes(
  resolvedBinding: DesignerRuntimeResolvedBinding,
): ReadonlyArray<EgressCredentialRoute> {
  const compileBindingResult = resolvedBinding.definition.compileBinding(
    resolvedBinding.compileBindingInput,
  );

  return compileBindingResult.egressRoutes.map((route, routeIndex) => ({
    ...route,
    egressRuleId:
      routeIndex === 0
        ? `egress_rule_${resolvedBinding.compileBindingInput.binding.id}`
        : `egress_rule_${resolvedBinding.compileBindingInput.binding.id}_${String(routeIndex + 1)}`,
    bindingId: resolvedBinding.compileBindingInput.binding.id,
    familyId: resolvedBinding.compileBindingInput.target.familyId,
    variantId: resolvedBinding.compileBindingInput.target.variantId,
  }));
}

function resolveRemoteMcpEgressRouteMatchers(input: {
  connectionId: string;
  compiledRoutes: ReadonlyArray<EgressCredentialRoute>;
  mcpServers: ReadonlyArray<DesignerRuntimeProviderMcpServerConfig>;
  toolIds: readonly string[];
}): ReadonlyArray<DesignerRuntimeProviderEgressRouteMatcher> {
  const mcpHosts = new Set(
    input.mcpServers.map((server) => new URL(server.url).host.toLowerCase()),
  );

  return input.compiledRoutes
    .filter((route) => route.match.hosts.some((host) => mcpHosts.has(host.toLowerCase())))
    .map((route) => ({
      egressRuleId: route.egressRuleId,
      hosts: route.match.hosts,
      pathPrefixes: route.match.pathPrefixes ?? ["/"],
      ...(route.match.methods === undefined ? {} : { methods: route.match.methods }),
      designerRuntimeMcp: {
        integrationConnectionId: input.connectionId,
        providerToolIds: input.toolIds,
      },
    }));
}

async function requireDesignerSession(
  ctx: DesignerRuntimeProviderMcpContext,
  input: {
    organizationId: string;
    designerSessionId: string;
    sandboxInstanceId: string;
  },
): Promise<void> {
  const designerSession = await ctx.db.query.designerSessions.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.designerSessionId),
        eq(table.organizationId, input.organizationId),
        eq(table.sandboxInstanceId, input.sandboxInstanceId),
      ),
  });

  if (designerSession === undefined) {
    throw new NotFoundError(
      "DESIGNER_SESSION_NOT_FOUND",
      "Designer session was not found for runtime MCP installation.",
    );
  }
}

async function requireDesignerSessionById(
  ctx: DesignerRuntimeProviderMcpContext,
  input: {
    organizationId: string;
    designerSessionId: string;
  },
): Promise<{ sandboxInstanceId: string }> {
  const designerSession = await ctx.db.query.designerSessions.findFirst({
    columns: {
      sandboxInstanceId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.designerSessionId), eq(table.organizationId, input.organizationId)),
  });

  if (designerSession === undefined) {
    throw new NotFoundError(
      "DESIGNER_SESSION_NOT_FOUND",
      "Designer session was not found for runtime MCP installation.",
    );
  }

  return designerSession;
}

async function requireDesignerSandboxInstance(
  ctx: DesignerRuntimeProviderMcpContext,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
  },
): Promise<void> {
  const designerSession = await ctx.db.query.designerSessions.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.sandboxInstanceId, input.sandboxInstanceId),
      ),
  });

  if (designerSession === undefined) {
    throw new NotFoundError(
      "DESIGNER_SESSION_NOT_FOUND",
      "Designer session was not found for runtime egress resolution.",
    );
  }
}

async function resolveDesignerRuntimeBinding(
  ctx: DesignerRuntimeProviderMcpContext,
  input: {
    organizationId: string;
    connectionId: string;
    toolIds: readonly string[];
  },
): Promise<DesignerRuntimeResolvedBinding> {
  if (input.toolIds.length === 0) {
    throw new BadRequestError(
      "DESIGNER_RUNTIME_PROVIDER_TOOLS_REQUIRED",
      "At least one provider tool id is required for Designer runtime access.",
    );
  }

  const connection = await getDesignerRuntimeConnection(ctx, {
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  if (connection.status !== IntegrationConnectionStatuses.ACTIVE) {
    throw new BadRequestError(
      "INTEGRATION_CONNECTION_NOT_ACTIVE",
      "Integration connection must be active before it can be used by Designer runtime access.",
    );
  }

  const target = await getDesignerRuntimeTarget(ctx, {
    targetKey: connection.targetKey,
  });
  const definition = ctx.integrationRegistry.getDefinitionOrThrow({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  validateDesignerRuntimeToolSupport({
    definition,
    toolIds: input.toolIds,
  });

  const targetSecrets = resolveIntegrationTargetSecrets({
    integrationsConfig: ctx.integrationsConfig,
    target: {
      targetKey: target.targetKey,
      secrets: target.secrets,
    },
  });
  const parsedTargetConfig = definition.targetConfigSchema.parse(target.config);
  const parsedTargetSecrets = definition.targetSecretSchema.parse(targetSecrets);
  const bindingConfig = definition.bindingConfigSchema.parse({
    tools: [...input.toolIds],
  });
  const bindingConfigRecord = requireObjectRecord(bindingConfig, {
    errorCode: "DESIGNER_RUNTIME_BINDING_INVALID",
    message: "Designer runtime access binding config must be an object.",
  });
  const connectionConfig = normalizeConnectionConfig(connection.config);
  const bindingId = `designer_runtime_${connection.id}`;

  const bindingWriteValidation = runDefinitionBindingWriteValidation({
    definition,
    targetKey: target.targetKey,
    target: {
      familyId: target.familyId,
      variantId: target.variantId,
      config: target.config,
    },
    connection: {
      id: connection.id,
      config: connectionConfig,
    },
    binding: {
      kind: definition.kind,
      config: bindingConfigRecord,
    },
    bindingIdOrDraftIndex: bindingId,
  });
  if (!bindingWriteValidation.ok) {
    const firstIssue = bindingWriteValidation.issues[0];
    throw new BadRequestError(
      "DESIGNER_RUNTIME_BINDING_INVALID",
      firstIssue?.safeMessage ?? "Designer runtime access binding is invalid.",
    );
  }

  return {
    definition,
    compileBindingInput: {
      organizationId: input.organizationId,
      sandboxProfileId: "designer-runtime",
      version: 1,
      targetKey: target.targetKey,
      target: {
        familyId: target.familyId,
        variantId: target.variantId,
        enabled: target.enabled,
        config: parsedTargetConfig,
        secrets: parsedTargetSecrets,
      },
      connection: {
        id: connection.id,
        status: connection.status,
        ...(connection.externalSubjectId === null
          ? {}
          : { externalSubjectId: connection.externalSubjectId }),
        config: connectionConfig,
      },
      binding: {
        id: bindingId,
        kind: definition.kind,
        config: bindingConfig,
      },
      refs: {
        sandboxPaths: {
          userHomeDir: "/root",
          workspaceDir: "/root",
          runtimeDataDir: "/var/lib/mistle",
          runtimeArtifactDir: "/var/lib/mistle/artifacts",
          runtimeArtifactBinDir: "/usr/local/bin",
        },
        artifactBinPath: (name) => `/usr/local/bin/${name}`,
      },
    },
  };
}

async function getDesignerRuntimeConnection(
  ctx: DesignerRuntimeProviderMcpContext,
  input: {
    organizationId: string;
    connectionId: string;
  },
): Promise<DesignerRuntimeConnectionRecord> {
  const connection = await ctx.db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      organizationId: true,
      targetKey: true,
      status: true,
      externalSubjectId: true,
      config: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.connectionId), eq(table.organizationId, input.organizationId)),
  });

  if (connection === undefined) {
    throw new NotFoundError(
      "INTEGRATION_CONNECTION_NOT_FOUND",
      "Integration connection was not found for Designer runtime access.",
    );
  }

  return connection;
}

async function getDesignerRuntimeTarget(
  ctx: DesignerRuntimeProviderMcpContext,
  input: {
    targetKey: string;
  },
): Promise<DesignerRuntimeTargetRecord> {
  const target = await ctx.db.query.integrationTargets.findFirst({
    columns: {
      targetKey: true,
      familyId: true,
      variantId: true,
      enabled: true,
      config: true,
      secrets: true,
    },
    where: (table, { eq }) => eq(table.targetKey, input.targetKey),
  });

  if (target === undefined) {
    throw new NotFoundError(
      "INTEGRATION_TARGET_NOT_FOUND",
      "Integration target was not found for Designer runtime access.",
    );
  }

  if (!target.enabled) {
    throw new BadRequestError(
      "INTEGRATION_TARGET_DISABLED",
      "Integration target is disabled and cannot be used by Designer runtime access.",
    );
  }

  return target;
}

function validateDesignerRuntimeToolSupport(input: {
  definition: AnyIntegrationDefinition;
  toolIds: readonly string[];
}): void {
  const supportedTools = input.definition.designerRuntimeAccess?.tools ?? [];
  const supportedRemoteMcpToolIds = new Set(
    supportedTools
      .filter((tool) => tool.installMode === DesignerRuntimeAccessInstallModes.REMOTE_MCP)
      .map((tool) => tool.toolId),
  );
  const unsupportedToolId = input.toolIds.find((toolId) => !supportedRemoteMcpToolIds.has(toolId));

  if (unsupportedToolId !== undefined) {
    throw new BadRequestError(
      "UNSUPPORTED_DESIGNER_RUNTIME_PROVIDER_TOOL",
      `Provider tool '${unsupportedToolId}' is not supported for Designer runtime remote MCP installation.`,
    );
  }
}

function resolveRemoteMcpServers(input: {
  definition: AnyIntegrationDefinition;
  compileBindingInput: CompileBindingInput<unknown, unknown, unknown>;
  connectionId: string;
  toolIds: readonly string[];
}): ReadonlyArray<DesignerRuntimeProviderMcpServerConfig> {
  if (input.definition.mcp === undefined) {
    throw new BadRequestError(
      "DESIGNER_RUNTIME_PROVIDER_MCP_UNAVAILABLE",
      "Integration definition does not provide MCP server metadata.",
    );
  }

  const rawMcpServers = normalizeMcpDefinitionValue(
    typeof input.definition.mcp === "function"
      ? input.definition.mcp(input.compileBindingInput)
      : input.definition.mcp,
  );
  const remoteServers = rawMcpServers.filter(
    (server) => server.transport === IntegrationMcpTransports.STREAMABLE_HTTP,
  );
  if (remoteServers.length === 0) {
    throw new BadRequestError(
      "UNSUPPORTED_DESIGNER_RUNTIME_PROVIDER_TOOL_INSTALL_MODE",
      "Designer runtime access only supports remote MCP provider tools.",
    );
  }

  return remoteServers.map((server) => {
    if (server.url === undefined) {
      throw new BadRequestError(
        "DESIGNER_RUNTIME_PROVIDER_MCP_INVALID",
        "Remote MCP server metadata is missing a URL.",
      );
    }

    return {
      serverName: `${server.serverName}_${input.connectionId}`,
      transport: "streamable_http",
      url: server.url,
      httpHeaders: {
        ...(server.httpHeaders ?? {}),
      },
    };
  });
}

function normalizeMcpDefinitionValue(
  input: IntegrationMcpDefinitionValue,
): ReadonlyArray<IntegrationMcpServer> {
  if (isIntegrationMcpServerArray(input)) {
    return input;
  }

  return [input];
}

function isIntegrationMcpServerArray(
  input: IntegrationMcpDefinitionValue,
): input is ReadonlyArray<IntegrationMcpServer> {
  return Array.isArray(input);
}

function requireObjectRecord(
  input: unknown,
  error: {
    errorCode: string;
    message: string;
  },
): Record<string, unknown> {
  const parsedInput = UnknownRecordSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new BadRequestError(error.errorCode, error.message);
  }

  return parsedInput.data;
}

function normalizeConnectionConfig(
  connectionConfig: Record<string, unknown> | null,
): Record<string, unknown> {
  if (connectionConfig === null) {
    return {};
  }

  return connectionConfig;
}
