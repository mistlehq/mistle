import { z } from "zod";

import {
  RuntimeFileWriteMode,
  SandboxImageSources,
  type CompiledRuntimePlan,
} from "../types/index.js";

const ResolvedSandboxImageSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal(SandboxImageSources.PROFILE_BASE),
      imageRef: z.string().min(1),
      sandboxProfileId: z.string().min(1),
      version: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      source: z.literal(SandboxImageSources.BASE),
      imageRef: z.string().min(1),
    })
    .strict(),
]);

const EgressCredentialRouteSchema = z
  .object({
    egressRuleId: z.string().min(1),
    bindingId: z.string().min(1),
    match: z
      .object({
        hosts: z.array(z.string().min(1)).readonly(),
        pathPrefixes: z.array(z.string().min(1)).readonly().optional(),
        methods: z.array(z.string().min(1)).readonly().optional(),
      })
      .strict(),
    upstream: z
      .object({
        baseUrl: z.string().min(1),
      })
      .strict(),
    authInjection: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("bearer"),
          target: z.string().min(1),
        })
        .strict(),
      z
        .object({
          type: z.literal("basic"),
          target: z.string().min(1),
          username: z.string().min(1).optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("header"),
          target: z.string().min(1),
        })
        .strict(),
      z
        .object({
          type: z.literal("query"),
          target: z.string().min(1),
        })
        .strict(),
      z
        .object({
          type: z.literal("aws_sigv4"),
          service: z.string().min(1),
          region: z.string().min(1),
        })
        .strict(),
    ]),
    additionalHeaders: z.record(z.string(), z.string()).optional(),
    additionalCredentialHeaders: z
      .array(
        z
          .object({
            header: z.string().min(1),
            credentialResolver: z
              .object({
                connectionId: z.string().min(1),
                secretType: z.string().min(1),
                slotKey: z.string().min(1).optional(),
                resolverKey: z.string().min(1).optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .readonly()
      .optional(),
    credentialResolver: z
      .object({
        connectionId: z.string().min(1),
        secretType: z.string().min(1),
        slotKey: z.string().min(1).optional(),
        resolverKey: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

const RuntimeExecCommandSchema = z
  .object({
    args: z.array(z.string()).readonly(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

const RuntimeArtifactGitHubReleaseSelectorSchema = z.union([
  z
    .object({
      kind: z.literal("latest"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tag"),
      match: z.literal("exact"),
      tag: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tag"),
      match: z.literal("latest_matching_prefix"),
      prefix: z.string().min(1),
    })
    .strict(),
]);

const RuntimeArtifactGitHubReleaseAssetBinarySchema = z
  .object({
    fileName: z.string().min(1),
    format: z.literal("binary"),
  })
  .strict();

const RuntimeArtifactGitHubReleaseAssetTarGzSchema = z
  .object({
    fileName: z.string().min(1),
    format: z.literal("tar.gz"),
    extractedPath: z.string().min(1),
  })
  .strict();

const RuntimeArtifactGitHubReleaseAssetShapeSchema = z.union([
  RuntimeArtifactGitHubReleaseAssetBinarySchema,
  RuntimeArtifactGitHubReleaseAssetTarGzSchema,
]);

const RuntimeArtifactGitHubReleaseInstallAssetSchema = z.union([
  z
    .object({
      kind: z.literal("exact"),
      fileName: z.string().min(1),
      format: z.literal("binary"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("exact"),
      fileName: z.string().min(1),
      format: z.literal("tar.gz"),
      extractedPath: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("by_arch"),
      x86_64: RuntimeArtifactGitHubReleaseAssetShapeSchema,
      aarch64: RuntimeArtifactGitHubReleaseAssetShapeSchema,
    })
    .strict(),
]);

const RuntimeArtifactInstallStepSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("github_release_install"),
      repository: z.string().min(1),
      release: RuntimeArtifactGitHubReleaseSelectorSchema,
      asset: RuntimeArtifactGitHubReleaseInstallAssetSchema,
      installPath: z.string().min(1),
      timeoutMs: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("mise_install"),
      tools: z.array(z.string().min(1)).min(1).readonly(),
      force: z.boolean().optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("exec"),
      command: RuntimeExecCommandSchema,
    })
    .strict(),
]);

const CompiledRuntimeArtifactSpecSchema = z
  .object({
    artifactKey: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    env: z.record(z.string(), z.string()).optional(),
    lifecycle: z
      .object({
        install: z.array(RuntimeArtifactInstallStepSchema).readonly(),
      })
      .strict(),
  })
  .strict();

const RuntimeClientSetupSchema = z
  .object({
    env: z.record(z.string(), z.string()),
    files: z
      .array(
        z
          .object({
            fileId: z.string().min(1),
            path: z.string().min(1),
            mode: z.number().int().min(0),
            content: z.string(),
            writeMode: z
              .enum([RuntimeFileWriteMode.OVERWRITE, RuntimeFileWriteMode.IF_ABSENT])
              .optional(),
          })
          .strict(),
      )
      .readonly(),
    launchArgs: z.array(z.string()).readonly().optional(),
  })
  .strict();

const RuntimeClientProcessReadinessSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("none"),
    })
    .strict(),
  z
    .object({
      type: z.literal("tcp"),
      host: z.string().min(1),
      port: z.number().int().min(1).max(65_535),
      timeoutMs: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("http"),
      url: z.url(),
      expectedStatus: z.number().int().min(100).max(599),
      timeoutMs: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("ws"),
      url: z.url().refine((value) => {
        const parsedURL = new URL(value);
        return parsedURL.protocol === "ws:" || parsedURL.protocol === "wss:";
      }, "URL must use ws or wss scheme"),
      timeoutMs: z.number().int().positive(),
    })
    .strict(),
]);

const RuntimeClientProcessStopPolicySchema = z
  .object({
    signal: z.enum(["sigterm", "sigkill"]),
    timeoutMs: z.number().int().positive(),
    gracePeriodMs: z.number().int().min(0).optional(),
  })
  .strict();

const RuntimeClientProcessSchema = z
  .object({
    processKey: z.string().min(1),
    command: RuntimeExecCommandSchema,
    readiness: RuntimeClientProcessReadinessSchema,
    stop: RuntimeClientProcessStopPolicySchema,
  })
  .strict();

const RuntimeClientEndpointTransportSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ws"),
      url: z.url().refine((value) => {
        const parsedURL = new URL(value);
        return parsedURL.protocol === "ws:" || parsedURL.protocol === "wss:";
      }, "URL must use ws or wss scheme"),
    })
    .strict(),
]);

const RuntimeClientEndpointSchema = z
  .object({
    endpointKey: z.string().min(1),
    processKey: z.string().min(1).optional(),
    transport: RuntimeClientEndpointTransportSchema,
    connectionMode: z.enum(["dedicated", "shared"]),
  })
  .strict();

const RuntimeClientSchema = z
  .object({
    clientId: z.string().min(1),
    setup: RuntimeClientSetupSchema,
    processes: z.array(RuntimeClientProcessSchema).readonly(),
    endpoints: z.array(RuntimeClientEndpointSchema).readonly(),
  })
  .strict();

const AgentPtyLaunchArgumentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("literal"),
      value: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("threadId"),
    })
    .strict(),
]);

const AgentPtyLaunchTemplateSchema = z
  .object({
    ptySessionId: z.string().min(1),
    cols: z.int().positive(),
    rows: z.int().positive(),
    cwd: z.string().min(1).optional(),
    command: z.string().min(1),
    args: z.array(AgentPtyLaunchArgumentSchema).readonly(),
  })
  .strict();

const AgentPtyLaunchSpecSchema = z
  .object({
    runtimeId: z.string().min(1),
    displayName: z.string().min(1),
    newLaunch: AgentPtyLaunchTemplateSchema,
    resumeLaunch: AgentPtyLaunchTemplateSchema,
  })
  .strict();

const CompiledAgentRuntimeSchema = z
  .object({
    bindingId: z.string().min(1),
    runtimeId: z.string().min(1),
    runtimeKey: z.string().min(1),
    clientId: z.string().min(1),
    endpointKey: z.string().min(1),
    ptyLaunch: AgentPtyLaunchSpecSchema,
  })
  .strict();

const CompiledWorkspaceSourceSchema = z.discriminatedUnion("sourceKind", [
  z
    .object({
      sourceKind: z.literal("git-clone"),
      resourceKind: z.literal("repository"),
      path: z.string().min(1),
      originUrl: z.url(),
    })
    .strict(),
]);

type RuntimePlanRoute = CompiledRuntimePlan["egressRoutes"][number];
type RuntimePlanArtifact = CompiledRuntimePlan["artifacts"][number];
type RuntimePlanExecCommand =
  CompiledRuntimePlan["runtimeClients"][number]["processes"][number]["command"];
type RuntimePlanRuntimeClient = CompiledRuntimePlan["runtimeClients"][number];
type RuntimePlanRuntimeClientProcess = RuntimePlanRuntimeClient["processes"][number];
type RuntimePlanRuntimeClientEndpoint = RuntimePlanRuntimeClient["endpoints"][number];
type RuntimePlanRuntimeClientFile = RuntimePlanRuntimeClient["setup"]["files"][number];
type RuntimePlanWorkspaceSource = CompiledRuntimePlan["workspaceSources"][number];
type RuntimePlanAgentRuntime = CompiledRuntimePlan["agentRuntimes"][number];

function sortRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
  );
}

const HeaderNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function normalizeAdditionalHeaders(
  input: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (input === undefined) {
    return undefined;
  }

  const normalizedHeaders: Record<string, string> = {};

  for (const [rawHeaderName, rawHeaderValue] of Object.entries(input)) {
    const normalizedHeaderName = rawHeaderName.trim().toLowerCase();
    const normalizedHeaderValue = rawHeaderValue.trim();

    if (normalizedHeaderName.length === 0 || !HeaderNamePattern.test(normalizedHeaderName)) {
      throw new Error(
        `Invalid additional header name '${rawHeaderName}' in compiled runtime plan.`,
      );
    }

    if (normalizedHeaderValue.length === 0) {
      throw new Error(
        `Invalid additional header value for '${rawHeaderName}' in compiled runtime plan.`,
      );
    }

    if (normalizedHeaders[normalizedHeaderName] !== undefined) {
      throw new Error(
        `Duplicate additional header '${normalizedHeaderName}' in compiled runtime plan.`,
      );
    }

    normalizedHeaders[normalizedHeaderName] = normalizedHeaderValue;
  }

  if (Object.keys(normalizedHeaders).length === 0) {
    return undefined;
  }

  return sortRecord(normalizedHeaders);
}

function normalizeAdditionalCredentialHeaders(input: {
  additionalCredentialHeaders:
    | z.output<typeof EgressCredentialRouteSchema>["additionalCredentialHeaders"]
    | undefined;
  additionalHeaders: Record<string, string> | undefined;
  authInjection: z.output<typeof EgressCredentialRouteSchema>["authInjection"];
}): RuntimePlanRoute["additionalCredentialHeaders"] {
  if (
    input.additionalCredentialHeaders === undefined ||
    input.additionalCredentialHeaders.length === 0
  ) {
    return undefined;
  }

  if (input.authInjection.type === "aws_sigv4") {
    throw new Error(
      "Compiled runtime plan cannot combine aws_sigv4 auth injection with additional credential-backed headers.",
    );
  }

  const occupiedHeaderNames = new Set<string>(Object.keys(input.additionalHeaders ?? {}));
  if (input.authInjection.type !== "query") {
    occupiedHeaderNames.add(input.authInjection.target.trim().toLowerCase());
  }

  const normalizedHeaders = input.additionalCredentialHeaders.map((headerInjection) => {
    const normalizedHeaderName = headerInjection.header.trim().toLowerCase();

    if (normalizedHeaderName.length === 0 || !HeaderNamePattern.test(normalizedHeaderName)) {
      throw new Error(
        `Invalid additional credential-backed header name '${headerInjection.header}' in compiled runtime plan.`,
      );
    }

    if (occupiedHeaderNames.has(normalizedHeaderName)) {
      throw new Error(
        `Duplicate additional credential-backed header '${normalizedHeaderName}' in compiled runtime plan.`,
      );
    }

    occupiedHeaderNames.add(normalizedHeaderName);

    return {
      header: normalizedHeaderName,
      credentialResolver: {
        connectionId: headerInjection.credentialResolver.connectionId,
        secretType: headerInjection.credentialResolver.secretType,
        ...(headerInjection.credentialResolver.slotKey === undefined
          ? {}
          : { slotKey: headerInjection.credentialResolver.slotKey }),
        ...(headerInjection.credentialResolver.resolverKey === undefined
          ? {}
          : { resolverKey: headerInjection.credentialResolver.resolverKey }),
      },
    };
  });

  return normalizedHeaders.sort((left, right) => {
    if (left.header !== right.header) {
      return left.header.localeCompare(right.header);
    }

    if (left.credentialResolver.connectionId !== right.credentialResolver.connectionId) {
      return left.credentialResolver.connectionId.localeCompare(
        right.credentialResolver.connectionId,
      );
    }

    if (left.credentialResolver.secretType !== right.credentialResolver.secretType) {
      return left.credentialResolver.secretType.localeCompare(right.credentialResolver.secretType);
    }

    if (left.credentialResolver.slotKey !== right.credentialResolver.slotKey) {
      return (left.credentialResolver.slotKey ?? "").localeCompare(
        right.credentialResolver.slotKey ?? "",
      );
    }

    return (left.credentialResolver.resolverKey ?? "").localeCompare(
      right.credentialResolver.resolverKey ?? "",
    );
  });
}

function normalizeRuntimeExecCommand(
  command: z.output<typeof RuntimeExecCommandSchema>,
): RuntimePlanExecCommand {
  return {
    args: command.args,
    ...(command.env === undefined ? {} : { env: command.env }),
    ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
    ...(command.timeoutMs === undefined ? {} : { timeoutMs: command.timeoutMs }),
  };
}

function normalizeGitHubReleaseAssetShape(
  asset: z.output<typeof RuntimeArtifactGitHubReleaseAssetShapeSchema>,
) {
  if (asset.format === "tar.gz") {
    return {
      fileName: asset.fileName,
      format: "tar.gz" as const,
      extractedPath: asset.extractedPath,
    };
  }

  return {
    fileName: asset.fileName,
    ...(asset.format === undefined ? {} : { format: asset.format }),
  };
}

function normalizeGitHubReleaseInstallAsset(
  asset: z.output<typeof RuntimeArtifactGitHubReleaseInstallAssetSchema>,
) {
  if (asset.kind === "exact") {
    return {
      kind: "exact" as const,
      ...normalizeGitHubReleaseAssetShape(asset),
    };
  }

  return {
    kind: "by_arch" as const,
    x86_64: normalizeGitHubReleaseAssetShape(asset.x86_64),
    aarch64: normalizeGitHubReleaseAssetShape(asset.aarch64),
  };
}

function normalizeRuntimeArtifactInstallEntry(
  entry: z.output<typeof RuntimeArtifactInstallStepSchema>,
): RuntimePlanArtifact["lifecycle"]["install"][number] {
  if (entry.op === "exec") {
    return {
      op: "exec",
      command: normalizeRuntimeExecCommand(entry.command),
    };
  }

  if (entry.op === "mise_install") {
    return {
      op: "mise_install",
      tools: entry.tools,
      ...(entry.force === undefined ? {} : { force: entry.force }),
      ...(entry.timeoutMs === undefined ? {} : { timeoutMs: entry.timeoutMs }),
    };
  }

  return {
    op: "github_release_install",
    repository: entry.repository,
    release:
      entry.release.kind === "latest"
        ? {
            kind: "latest",
          }
        : entry.release.match === "exact"
          ? {
              kind: "tag",
              match: "exact",
              tag: entry.release.tag,
            }
          : {
              kind: "tag",
              match: "latest_matching_prefix",
              prefix: entry.release.prefix,
            },
    asset: normalizeGitHubReleaseInstallAsset(entry.asset),
    installPath: entry.installPath,
    ...(entry.timeoutMs === undefined ? {} : { timeoutMs: entry.timeoutMs }),
  };
}

function normalizeRoute(route: z.output<typeof EgressCredentialRouteSchema>): RuntimePlanRoute {
  const additionalHeaders = normalizeAdditionalHeaders(route.additionalHeaders);
  const authInjection =
    route.authInjection.type === "aws_sigv4"
      ? {
          type: route.authInjection.type,
          service: route.authInjection.service,
          region: route.authInjection.region,
        }
      : {
          type: route.authInjection.type,
          target: route.authInjection.target,
          ...(route.authInjection.type !== "basic" || route.authInjection.username === undefined
            ? {}
            : { username: route.authInjection.username }),
        };
  const additionalCredentialHeaders = normalizeAdditionalCredentialHeaders({
    additionalCredentialHeaders: route.additionalCredentialHeaders,
    additionalHeaders,
    authInjection: route.authInjection,
  });

  return {
    egressRuleId: route.egressRuleId,
    bindingId: route.bindingId,
    match: {
      hosts: route.match.hosts,
      ...(route.match.pathPrefixes === undefined ? {} : { pathPrefixes: route.match.pathPrefixes }),
      ...(route.match.methods === undefined ? {} : { methods: route.match.methods }),
    },
    upstream: {
      baseUrl: route.upstream.baseUrl,
    },
    authInjection,
    ...(additionalHeaders === undefined ? {} : { additionalHeaders }),
    ...(additionalCredentialHeaders === undefined ? {} : { additionalCredentialHeaders }),
    credentialResolver: {
      connectionId: route.credentialResolver.connectionId,
      secretType: route.credentialResolver.secretType,
      ...(route.credentialResolver.slotKey === undefined
        ? {}
        : { slotKey: route.credentialResolver.slotKey }),
      ...(route.credentialResolver.resolverKey === undefined
        ? {}
        : { resolverKey: route.credentialResolver.resolverKey }),
    },
  };
}

function normalizeArtifact(
  artifact: z.output<typeof CompiledRuntimeArtifactSpecSchema>,
): RuntimePlanArtifact {
  return {
    artifactKey: artifact.artifactKey,
    name: artifact.name,
    ...(artifact.description === undefined ? {} : { description: artifact.description }),
    ...(artifact.env === undefined ? {} : { env: sortRecord(artifact.env) }),
    lifecycle: {
      install: artifact.lifecycle.install.map(normalizeRuntimeArtifactInstallEntry),
    },
  };
}

function normalizeRuntimeClientFile(
  file: z.output<typeof RuntimeClientSetupSchema>["files"][number],
): RuntimePlanRuntimeClientFile {
  return {
    fileId: file.fileId,
    path: file.path,
    mode: file.mode,
    content: file.content,
    ...(file.writeMode === undefined ? {} : { writeMode: file.writeMode }),
  };
}

function normalizeRuntimeClientProcess(
  process: z.output<typeof RuntimeClientProcessSchema>,
): RuntimePlanRuntimeClientProcess {
  return {
    processKey: process.processKey,
    command: normalizeRuntimeExecCommand(process.command),
    readiness:
      process.readiness.type === "none"
        ? {
            type: "none",
          }
        : process.readiness.type === "tcp"
          ? {
              type: "tcp",
              host: process.readiness.host,
              port: process.readiness.port,
              timeoutMs: process.readiness.timeoutMs,
            }
          : process.readiness.type === "http"
            ? {
                type: "http",
                url: process.readiness.url,
                expectedStatus: process.readiness.expectedStatus,
                timeoutMs: process.readiness.timeoutMs,
              }
            : {
                type: "ws",
                url: process.readiness.url,
                timeoutMs: process.readiness.timeoutMs,
              },
    stop: {
      signal: process.stop.signal,
      timeoutMs: process.stop.timeoutMs,
      ...(process.stop.gracePeriodMs === undefined
        ? {}
        : { gracePeriodMs: process.stop.gracePeriodMs }),
    },
  };
}

function normalizeRuntimeClientEndpoint(
  endpoint: z.output<typeof RuntimeClientEndpointSchema>,
): RuntimePlanRuntimeClientEndpoint {
  return {
    endpointKey: endpoint.endpointKey,
    ...(endpoint.processKey === undefined ? {} : { processKey: endpoint.processKey }),
    transport: {
      type: endpoint.transport.type,
      url: endpoint.transport.url,
    },
    connectionMode: endpoint.connectionMode,
  };
}

function normalizeRuntimeClient(
  runtimeClient: z.output<typeof RuntimeClientSchema>,
): RuntimePlanRuntimeClient {
  return {
    clientId: runtimeClient.clientId,
    setup: {
      env: runtimeClient.setup.env,
      files: runtimeClient.setup.files.map(normalizeRuntimeClientFile),
      ...(runtimeClient.setup.launchArgs === undefined
        ? {}
        : { launchArgs: runtimeClient.setup.launchArgs }),
    },
    processes: runtimeClient.processes.map(normalizeRuntimeClientProcess),
    endpoints: runtimeClient.endpoints.map(normalizeRuntimeClientEndpoint),
  };
}

function normalizeWorkspaceSource(
  workspaceSource: z.output<typeof CompiledWorkspaceSourceSchema>,
): RuntimePlanWorkspaceSource {
  return {
    sourceKind: workspaceSource.sourceKind,
    resourceKind: workspaceSource.resourceKind,
    path: workspaceSource.path,
    originUrl: workspaceSource.originUrl,
  };
}

function normalizeAgentRuntime(
  agentRuntime: z.output<typeof CompiledAgentRuntimeSchema>,
): RuntimePlanAgentRuntime {
  return {
    bindingId: agentRuntime.bindingId,
    runtimeId: agentRuntime.runtimeId,
    runtimeKey: agentRuntime.runtimeKey,
    clientId: agentRuntime.clientId,
    endpointKey: agentRuntime.endpointKey,
    ptyLaunch: {
      runtimeId: agentRuntime.ptyLaunch.runtimeId,
      displayName: agentRuntime.ptyLaunch.displayName,
      newLaunch: {
        ptySessionId: agentRuntime.ptyLaunch.newLaunch.ptySessionId,
        cols: agentRuntime.ptyLaunch.newLaunch.cols,
        rows: agentRuntime.ptyLaunch.newLaunch.rows,
        ...(agentRuntime.ptyLaunch.newLaunch.cwd === undefined
          ? {}
          : { cwd: agentRuntime.ptyLaunch.newLaunch.cwd }),
        command: agentRuntime.ptyLaunch.newLaunch.command,
        args: agentRuntime.ptyLaunch.newLaunch.args,
      },
      resumeLaunch: {
        ptySessionId: agentRuntime.ptyLaunch.resumeLaunch.ptySessionId,
        cols: agentRuntime.ptyLaunch.resumeLaunch.cols,
        rows: agentRuntime.ptyLaunch.resumeLaunch.rows,
        ...(agentRuntime.ptyLaunch.resumeLaunch.cwd === undefined
          ? {}
          : { cwd: agentRuntime.ptyLaunch.resumeLaunch.cwd }),
        command: agentRuntime.ptyLaunch.resumeLaunch.command,
        args: agentRuntime.ptyLaunch.resumeLaunch.args,
      },
    },
  };
}

const CompiledRuntimePlanValidationSchema = z
  .object({
    sandboxProfileId: z.string().min(1),
    version: z.number().int().min(1),
    image: ResolvedSandboxImageSchema,
    egressRoutes: z.array(EgressCredentialRouteSchema).readonly(),
    artifacts: z.array(CompiledRuntimeArtifactSpecSchema).readonly(),
    workspaceSources: z.array(CompiledWorkspaceSourceSchema).readonly(),
    runtimeClients: z.array(RuntimeClientSchema).readonly(),
    agentRuntimes: z.array(CompiledAgentRuntimeSchema).readonly(),
  })
  .strict();

export const CompiledRuntimePlanSchema = CompiledRuntimePlanValidationSchema.transform(
  (runtimePlan): CompiledRuntimePlan => ({
    sandboxProfileId: runtimePlan.sandboxProfileId,
    version: runtimePlan.version,
    image: runtimePlan.image,
    egressRoutes: runtimePlan.egressRoutes.map(normalizeRoute),
    artifacts: runtimePlan.artifacts.map(normalizeArtifact),
    workspaceSources: runtimePlan.workspaceSources.map(normalizeWorkspaceSource),
    runtimeClients: runtimePlan.runtimeClients.map(normalizeRuntimeClient),
    agentRuntimes: runtimePlan.agentRuntimes.map(normalizeAgentRuntime),
  }),
);
