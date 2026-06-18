import type {
  DataPlaneSandboxInstancesClient,
  GetSandboxInstanceResponse,
} from "@mistle/data-plane-internal-client";
import {
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
  type DesignerSession,
} from "@mistle/db/control-plane";
import { SandboxInstancePurposes, type SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import {
  CompiledRuntimePlanSchema,
  type CompiledRuntimeArtifactSpec,
  type EgressCredentialRoute,
  type RuntimeArtifactRefs,
  type RuntimeArtifactSpec,
  type RuntimeExecCommand,
  SandboxImageSources,
  createDisabledAssociatedResourceEventRouting,
} from "@mistle/integrations-core";
import { compileCodexRuntime } from "@mistle/integrations-definitions/agent-runtimes/codex";
import { and, desc, eq, sql } from "drizzle-orm";
import { typeid } from "typeid-js";

import {
  resolveMistleMcpEgressRoutes,
  resolveMistleMcpServers,
} from "../../sandbox-profiles/services/compile-sandbox-runtime-plan.js";
import { createWorkflowSandboxRuntime } from "../../sandbox-profiles/services/profile-version-runtime-config.js";
import type { ControlPlaneApiMcpConfig, ControlPlaneApiSandboxRuntimeConfig } from "../../types.js";
import {
  DESIGNER_RUNTIME_PROFILE_ID,
  DESIGNER_RUNTIME_PROFILE_VERSION,
  DesignerBadRequestCodes,
  DesignerNotFoundCodes,
} from "../constants.js";
import { DesignerBadRequestError, DesignerNotFoundError } from "../errors.js";
import type {
  CreateDesignerSessionBody,
  DesignerSessionResponse,
  PutDesignerSessionCanvasTabsBody,
} from "../schemas.js";

type DesignerSessionActor = {
  kind: SandboxInstanceStarterKind;
  id: string;
  actingUserId?: string;
};

type DesignerSessionServiceContext = {
  db: ControlPlaneDatabase;
  dataPlaneClient: Pick<
    DataPlaneSandboxInstancesClient,
    "getSandboxInstance" | "startSandboxInstance"
  >;
  mcpConfig: ControlPlaneApiMcpConfig;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
};

type DesignerSessionSelector =
  | {
      kind: "sessionId";
      sessionId: string;
    }
  | {
      kind: "sandboxInstanceId";
      sandboxInstanceId: string;
    };

const DesignerRuntimeId = "codex";
const DesignerSandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
} as const;

function resolveDesignerSandboxConfig(sandboxConfig: ControlPlaneApiSandboxRuntimeConfig) {
  if (sandboxConfig.designer === undefined) {
    throw new DesignerBadRequestError(
      DesignerBadRequestCodes.DESIGNER_SANDBOX_RUNTIME_UNAVAILABLE,
      "Designer sessions require sandbox.designer runtime configuration.",
    );
  }

  return sandboxConfig.designer;
}

function createPlatformOpenAiEgressRoute(): EgressCredentialRoute {
  return {
    egressRuleId: "egress_rule_platform_openai",
    bindingId: "platform-openai",
    familyId: "openai",
    variantId: "openai-default",
    match: {
      hosts: ["api.openai.com"],
      pathPrefixes: ["/"],
      methods: ["GET", "POST"],
    },
    upstream: {
      baseUrl: "https://api.openai.com/v1",
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "platform_openai_api_key",
    },
  };
}

function createRuntimeExecCommand(command: RuntimeExecCommand): RuntimeExecCommand {
  return {
    args: [...command.args],
    ...(command.env === undefined ? {} : { env: { ...command.env } }),
    ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
    ...(command.timeoutMs === undefined ? {} : { timeoutMs: command.timeoutMs }),
  };
}

function createDesignerRuntimeArtifactRefs(input: {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
}): RuntimeArtifactRefs {
  return {
    command: {
      exec: (command) => ({
        op: "exec",
        command: createRuntimeExecCommand(command),
      }),
    },
    sandboxPaths: DesignerSandboxPaths,
    artifactBinPath: (binaryName) => `${DesignerSandboxPaths.runtimeArtifactBinDir}/${binaryName}`,
    mise: {
      install: (installInput) => ({
        op: "mise_install",
        tools: [...installInput.tools],
        ...(installInput.force === undefined ? {} : { force: installInput.force }),
        ...(installInput.timeoutMs === undefined ? {} : { timeoutMs: installInput.timeoutMs }),
      }),
    },
    githubReleases: {
      install: (installInput) => ({
        op: "github_release_install",
        repository: installInput.repository,
        release:
          installInput.release.kind === "latest"
            ? { kind: "latest" }
            : installInput.release.match === "exact"
              ? {
                  kind: "tag",
                  match: "exact",
                  tag: installInput.release.tag,
                }
              : {
                  kind: "tag",
                  match: "latest_matching_prefix",
                  prefix: installInput.release.prefix,
                },
        asset:
          installInput.asset.kind === "exact"
            ? { ...installInput.asset }
            : {
                kind: "by_arch",
                x86_64: { ...installInput.asset.x86_64 },
                aarch64: { ...installInput.asset.aarch64 },
              },
        installPath: installInput.installPath,
        ...(installInput.timeoutMs === undefined ? {} : { timeoutMs: installInput.timeoutMs }),
      }),
    },
    compileContext: {
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      version: input.version,
      targetKey: "agent-runtime",
      bindingId: `agent-runtime-${DesignerRuntimeId}`,
    },
  };
}

function compileDesignerRuntimeArtifacts(input: {
  artifacts: ReadonlyArray<RuntimeArtifactSpec>;
  organizationId: string;
}): ReadonlyArray<CompiledRuntimeArtifactSpec> {
  const refs = createDesignerRuntimeArtifactRefs({
    organizationId: input.organizationId,
    sandboxProfileId: DESIGNER_RUNTIME_PROFILE_ID,
    version: DESIGNER_RUNTIME_PROFILE_VERSION,
  });

  return input.artifacts.map((artifact) => {
    const install =
      typeof artifact.lifecycle.install === "function"
        ? artifact.lifecycle.install({ refs })
        : artifact.lifecycle.install;

    return {
      artifactKey: artifact.artifactKey,
      name: artifact.name,
      ...(artifact.description === undefined ? {} : { description: artifact.description }),
      ...(artifact.env === undefined ? {} : { env: { ...artifact.env } }),
      lifecycle: {
        install,
      },
    };
  });
}

function createDesignerRuntimePlan(input: {
  designerSessionId: string;
  imageRef: string;
  mcpUrl: string;
  organizationId: string;
}) {
  const egressRoutes = [
    createPlatformOpenAiEgressRoute(),
    ...resolveMistleMcpEgressRoutes({
      enabled: true,
      credentialResolver: {
        kind: "mistle_mcp_designer_token",
        designerSessionId: input.designerSessionId,
      },
      url: input.mcpUrl,
    }),
  ];
  const mcpServers = resolveMistleMcpServers({
    enabled: true,
    url: input.mcpUrl,
  });
  const codexRuntime = compileCodexRuntime({
    organizationId: input.organizationId,
    sandboxProfileId: DESIGNER_RUNTIME_PROFILE_ID,
    version: DESIGNER_RUNTIME_PROFILE_VERSION,
    runtimeId: DesignerRuntimeId,
    runtimeConfig: {},
    mcpServers,
    refs: {
      sandboxPaths: DesignerSandboxPaths,
      artifactBinPath: (binaryName) => `/usr/local/bin/${binaryName}`,
    },
  });
  const runtimeClients =
    codexRuntime.renderRuntimeClients === undefined
      ? codexRuntime.runtimeClients
      : codexRuntime.renderRuntimeClients({ egressRoutes });
  const artifacts = compileDesignerRuntimeArtifacts({
    artifacts: codexRuntime.artifacts ?? [],
    organizationId: input.organizationId,
  });

  return CompiledRuntimePlanSchema.parse({
    sandboxProfileId: DESIGNER_RUNTIME_PROFILE_ID,
    version: DESIGNER_RUNTIME_PROFILE_VERSION,
    image: {
      source: SandboxImageSources.BASE,
      imageRef: input.imageRef,
    },
    associatedResourceEventRouting: createDisabledAssociatedResourceEventRouting(),
    egressRoutes,
    artifacts,
    workspaceSources: [],
    runtimeClients,
    agentRuntimes: codexRuntime.agentRuntimes,
  });
}

async function getDesignerSandboxInstance(
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
  },
): Promise<GetSandboxInstanceResponse> {
  return dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.sandboxInstanceId,
    allowedPurposes: [SandboxInstancePurposes.DESIGNER],
  });
}

function mapDesignerSession(
  designerSession: DesignerSession,
  sandboxInstance: GetSandboxInstanceResponse,
): DesignerSessionResponse {
  return {
    id: designerSession.id,
    organizationId: designerSession.organizationId,
    sandboxInstanceId: designerSession.sandboxInstanceId,
    title: sandboxInstance?.title ?? null,
    status: sandboxInstance?.status ?? null,
    connectable: sandboxInstance?.connectable ?? false,
    failureCode: sandboxInstance?.failureCode ?? null,
    failureMessage: sandboxInstance?.failureMessage ?? null,
    startupOperation: sandboxInstance?.startupOperation ?? null,
    canvasTabs: [...designerSession.canvasTabs],
    createdAt: designerSession.createdAt,
    updatedAt: designerSession.updatedAt,
  };
}

function createDesignerSessionNotFoundError(
  selector: DesignerSessionSelector,
): DesignerNotFoundError {
  switch (selector.kind) {
    case "sessionId":
      return new DesignerNotFoundError(
        DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND,
        `Designer session '${selector.sessionId}' was not found.`,
      );
    case "sandboxInstanceId":
      return new DesignerNotFoundError(
        DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND,
        `Designer session for sandbox instance '${selector.sandboxInstanceId}' was not found.`,
      );
  }
}

async function readDesignerSessionBySelector(
  ctx: Pick<DesignerSessionServiceContext, "db">,
  input: {
    organizationId: string;
    selector: DesignerSessionSelector;
  },
): Promise<DesignerSession> {
  const designerSession =
    input.selector.kind === "sessionId"
      ? await readDesignerSessionBySessionId(ctx, {
          organizationId: input.organizationId,
          sessionId: input.selector.sessionId,
        })
      : await readDesignerSessionBySandboxInstanceId(ctx, {
          organizationId: input.organizationId,
          sandboxInstanceId: input.selector.sandboxInstanceId,
        });

  if (designerSession === undefined) {
    throw createDesignerSessionNotFoundError(input.selector);
  }

  return designerSession;
}

async function readDesignerSessionBySessionId(
  ctx: Pick<DesignerSessionServiceContext, "db">,
  input: {
    organizationId: string;
    sessionId: string;
  },
): Promise<DesignerSession | undefined> {
  return ctx.db.query.designerSessions.findFirst({
    where: (table, { and, eq: whereEq }) =>
      and(whereEq(table.id, input.sessionId), whereEq(table.organizationId, input.organizationId)),
  });
}

async function readDesignerSessionBySandboxInstanceId(
  ctx: Pick<DesignerSessionServiceContext, "db">,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
  },
): Promise<DesignerSession | undefined> {
  return ctx.db.query.designerSessions.findFirst({
    where: (table, { and, eq: whereEq }) =>
      and(
        whereEq(table.sandboxInstanceId, input.sandboxInstanceId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });
}

async function mapDesignerSessionWithCurrentSandbox(
  ctx: Pick<DesignerSessionServiceContext, "dataPlaneClient">,
  input: {
    organizationId: string;
    designerSession: DesignerSession;
  },
): Promise<DesignerSessionResponse> {
  const sandboxInstance = await getDesignerSandboxInstance(ctx.dataPlaneClient, {
    organizationId: input.organizationId,
    sandboxInstanceId: input.designerSession.sandboxInstanceId,
  });

  return mapDesignerSession(input.designerSession, sandboxInstance);
}

async function updateDesignerSessionCanvasTabsBySelector(
  ctx: Pick<DesignerSessionServiceContext, "db">,
  input: {
    organizationId: string;
    selector: DesignerSessionSelector;
    body: PutDesignerSessionCanvasTabsBody;
  },
): Promise<DesignerSession> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedDesignerSessionRows =
    input.selector.kind === "sessionId"
      ? await ctx.db
          .update(tables.designerSessions)
          .set({
            canvasTabs: input.body.tabs,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(tables.designerSessions.id, input.selector.sessionId),
              eq(tables.designerSessions.organizationId, input.organizationId),
            ),
          )
          .returning()
      : await ctx.db
          .update(tables.designerSessions)
          .set({
            canvasTabs: input.body.tabs,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(tables.designerSessions.sandboxInstanceId, input.selector.sandboxInstanceId),
              eq(tables.designerSessions.organizationId, input.organizationId),
            ),
          )
          .returning();

  const updatedDesignerSession = updatedDesignerSessionRows[0];
  if (updatedDesignerSession === undefined) {
    throw createDesignerSessionNotFoundError(input.selector);
  }

  return updatedDesignerSession;
}

export async function createDesignerSession(
  ctx: DesignerSessionServiceContext,
  input: {
    organizationId: string;
    actor: DesignerSessionActor;
    body: CreateDesignerSessionBody;
  },
): Promise<DesignerSessionResponse> {
  const designerSandboxConfig = resolveDesignerSandboxConfig(ctx.sandboxConfig);
  const sandboxRuntime = createWorkflowSandboxRuntime({
    sandboxProvider: designerSandboxConfig.sandboxProvider,
    sandboxConnectionId: designerSandboxConfig.sandboxConnectionId,
    sandboxResources: designerSandboxConfig.sandboxResources,
  });
  const designerSessionId = typeid("dsn").toString();
  const runtimePlan = createDesignerRuntimePlan({
    designerSessionId,
    imageRef: designerSandboxConfig.baseImage,
    mcpUrl: ctx.mcpConfig.url,
    organizationId: input.organizationId,
  });
  const startedSandbox = await ctx.dataPlaneClient.startSandboxInstance({
    organizationId: input.organizationId,
    sandboxProfileId: DESIGNER_RUNTIME_PROFILE_ID,
    sandboxProfileVersion: DESIGNER_RUNTIME_PROFILE_VERSION,
    purpose: SandboxInstancePurposes.DESIGNER,
    idempotencyKey: input.body.idempotencyKey,
    runtimePlan,
    startedBy: {
      kind: input.actor.kind,
      id: input.actor.id,
    },
    ...(input.actor.actingUserId === undefined ? {} : { actingUserId: input.actor.actingUserId }),
    source: "dashboard",
    image: {
      imageId: designerSandboxConfig.baseImage,
      createdAt: new Date().toISOString(),
      kind: "base",
      provider: sandboxRuntime.provider,
    },
    sandboxRuntime,
  });

  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const createdDesignerSessionRows = await ctx.db
    .insert(tables.designerSessions)
    .values({
      id: designerSessionId,
      organizationId: input.organizationId,
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
      canvasTabs: [],
    })
    .onConflictDoNothing({
      target: [tables.designerSessions.sandboxInstanceId],
    })
    .returning();

  const createdDesignerSession = createdDesignerSessionRows[0];
  if (createdDesignerSession === undefined) {
    const existingDesignerSession = await readDesignerSessionBySelector(ctx, {
      organizationId: input.organizationId,
      selector: {
        kind: "sandboxInstanceId",
        sandboxInstanceId: startedSandbox.sandboxInstanceId,
      },
    });

    return mapDesignerSessionWithCurrentSandbox(ctx, {
      organizationId: input.organizationId,
      designerSession: existingDesignerSession,
    });
  }

  return mapDesignerSessionWithCurrentSandbox(ctx, {
    organizationId: input.organizationId,
    designerSession: createdDesignerSession,
  });
}

export async function listDesignerSessions(
  ctx: Pick<DesignerSessionServiceContext, "db" | "dataPlaneClient">,
  input: {
    organizationId: string;
    limit: number;
  },
): Promise<{ items: DesignerSessionResponse[] }> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const designerSessions = await ctx.db.query.designerSessions.findMany({
    where: (table, { eq: whereEq }) => whereEq(table.organizationId, input.organizationId),
    orderBy: [desc(tables.designerSessions.updatedAt), desc(tables.designerSessions.id)],
    limit: input.limit,
  });

  const items: DesignerSessionResponse[] = [];
  for (const designerSession of designerSessions) {
    items.push(
      await mapDesignerSessionWithCurrentSandbox(ctx, {
        organizationId: input.organizationId,
        designerSession,
      }),
    );
  }

  return { items };
}

export async function getDesignerSession(
  ctx: Pick<DesignerSessionServiceContext, "db" | "dataPlaneClient">,
  input: {
    organizationId: string;
    sessionId: string;
  },
): Promise<DesignerSessionResponse> {
  const designerSession = await readDesignerSessionBySelector(ctx, {
    organizationId: input.organizationId,
    selector: {
      kind: "sessionId",
      sessionId: input.sessionId,
    },
  });

  return mapDesignerSessionWithCurrentSandbox(ctx, {
    organizationId: input.organizationId,
    designerSession,
  });
}

export async function getDesignerSessionBySandboxInstanceId(
  ctx: Pick<DesignerSessionServiceContext, "db" | "dataPlaneClient">,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
  },
): Promise<DesignerSessionResponse> {
  const designerSession = await readDesignerSessionBySelector(ctx, {
    organizationId: input.organizationId,
    selector: {
      kind: "sandboxInstanceId",
      sandboxInstanceId: input.sandboxInstanceId,
    },
  });

  return mapDesignerSessionWithCurrentSandbox(ctx, {
    organizationId: input.organizationId,
    designerSession,
  });
}

export async function putDesignerSessionCanvasTabs(
  ctx: Pick<DesignerSessionServiceContext, "db" | "dataPlaneClient">,
  input: {
    organizationId: string;
    sessionId: string;
    body: PutDesignerSessionCanvasTabsBody;
  },
): Promise<DesignerSessionResponse> {
  const updatedDesignerSession = await updateDesignerSessionCanvasTabsBySelector(ctx, {
    organizationId: input.organizationId,
    selector: {
      kind: "sessionId",
      sessionId: input.sessionId,
    },
    body: input.body,
  });

  return mapDesignerSessionWithCurrentSandbox(ctx, {
    organizationId: input.organizationId,
    designerSession: updatedDesignerSession,
  });
}

export async function putDesignerSessionCanvasTabsBySandboxInstanceId(
  ctx: Pick<DesignerSessionServiceContext, "db" | "dataPlaneClient">,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    body: PutDesignerSessionCanvasTabsBody;
  },
): Promise<DesignerSessionResponse> {
  const updatedDesignerSession = await updateDesignerSessionCanvasTabsBySelector(ctx, {
    organizationId: input.organizationId,
    selector: {
      kind: "sandboxInstanceId",
      sandboxInstanceId: input.sandboxInstanceId,
    },
    body: input.body,
  });

  return mapDesignerSessionWithCurrentSandbox(ctx, {
    organizationId: input.organizationId,
    designerSession: updatedDesignerSession,
  });
}
