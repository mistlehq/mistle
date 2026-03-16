import { z } from "zod";

import { RuntimeFileWriteMode, type CompiledRuntimePlan } from "../types/index.js";

const ResolvedSandboxImageSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("profile-base"),
      imageRef: z.string().min(1),
      sandboxProfileId: z.string().min(1),
      version: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      source: z.literal("base"),
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
    authInjection: z
      .object({
        type: z.enum(["bearer", "basic", "header", "query"]),
        target: z.string().min(1),
        username: z.string().min(1).optional(),
      })
      .strict(),
    credentialResolver: z
      .object({
        connectionId: z.string().min(1),
        secretType: z.string().min(1),
        purpose: z.string().min(1).optional(),
        resolverKey: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

const RuntimeArtifactCommandSchema = z
  .object({
    args: z.array(z.string()).readonly(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

const CompiledRuntimeArtifactSpecSchema = z
  .object({
    artifactKey: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    env: z.record(z.string(), z.string()).optional(),
    lifecycle: z
      .object({
        install: z.array(RuntimeArtifactCommandSchema).readonly(),
        update: z.array(RuntimeArtifactCommandSchema).readonly().optional(),
        remove: z.array(RuntimeArtifactCommandSchema).readonly(),
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
    command: RuntimeArtifactCommandSchema,
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

const CompiledAgentRuntimeSchema = z
  .object({
    bindingId: z.string().min(1),
    runtimeKey: z.string().min(1),
    clientId: z.string().min(1),
    endpointKey: z.string().min(1),
    adapterKey: z.string().min(1),
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
type RuntimePlanArtifactCommand = RuntimePlanArtifact["lifecycle"]["install"][number];
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

function normalizeRuntimeArtifactCommand(
  command: z.output<typeof RuntimeArtifactCommandSchema>,
): RuntimePlanArtifactCommand {
  return {
    args: command.args,
    ...(command.env === undefined ? {} : { env: command.env }),
    ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
    ...(command.timeoutMs === undefined ? {} : { timeoutMs: command.timeoutMs }),
  };
}

function normalizeRoute(route: z.output<typeof EgressCredentialRouteSchema>): RuntimePlanRoute {
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
    authInjection: {
      type: route.authInjection.type,
      target: route.authInjection.target,
      ...(route.authInjection.username === undefined
        ? {}
        : { username: route.authInjection.username }),
    },
    credentialResolver: {
      connectionId: route.credentialResolver.connectionId,
      secretType: route.credentialResolver.secretType,
      ...(route.credentialResolver.purpose === undefined
        ? {}
        : { purpose: route.credentialResolver.purpose }),
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
      install: artifact.lifecycle.install.map(normalizeRuntimeArtifactCommand),
      ...(artifact.lifecycle.update === undefined
        ? {}
        : {
            update: artifact.lifecycle.update.map(normalizeRuntimeArtifactCommand),
          }),
      remove: artifact.lifecycle.remove.map(normalizeRuntimeArtifactCommand),
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
    command: normalizeRuntimeArtifactCommand(process.command),
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
    runtimeKey: agentRuntime.runtimeKey,
    clientId: agentRuntime.clientId,
    endpointKey: agentRuntime.endpointKey,
    adapterKey: agentRuntime.adapterKey,
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
