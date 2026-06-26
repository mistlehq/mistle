import { createHash } from "node:crypto";

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
  IntegrationMcpConfigFormats,
  IntegrationMcpTransports,
  type ResolvedIntegrationMcpServer,
  type RuntimeArtifactRefs,
  type RuntimeArtifactSpec,
  type RuntimeExecCommand,
  SandboxImageSources,
  applyMcpConfigToRuntimeClients,
  createDisabledAssociatedResourceEventRouting,
} from "@mistle/integrations-core";
import { compileInstalledCodexRuntime } from "@mistle/integrations-definitions/agent-runtimes/codex";
import { and, desc, eq, sql } from "drizzle-orm";
import { TypeID } from "typeid-js";

import { SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS } from "../../sandbox-instances/constants.js";
import { mintConnectionTokenForInstance } from "../../sandbox-instances/services/mint-connection-token-for-instance.js";
import { resolveSandboxInstanceRuntimeContext } from "../../sandbox-instances/services/runtime-context.js";
import {
  resolveMistleMcpEgressRoutes,
  resolveMistleMcpServers,
} from "../../sandbox-profiles/services/compile-sandbox-runtime-plan.js";
import { createWorkflowSandboxRuntime } from "../../sandbox-profiles/services/profile-version-runtime-config.js";
import type {
  ControlPlaneApiConnectionTokenConfig,
  ControlPlaneApiMcpConfig,
  ControlPlaneApiSandboxRuntimeConfig,
} from "../../types.js";
import {
  DESIGNER_RUNTIME_PROFILE_ID,
  DESIGNER_RUNTIME_PROFILE_VERSION,
  DesignerBadRequestCodes,
  DesignerNotFoundCodes,
} from "../constants.js";
import { DesignerBadRequestError, DesignerNotFoundError } from "../errors.js";
import type {
  CreateDesignerSessionBody,
  DesignerSessionListItemResponse,
  DesignerSessionResponse,
  PutDesignerSessionCanvasTabsBody,
} from "../schemas.js";
import { DesignerBehaviorInstructionBlock } from "./designer-behavior-instructions.js";
import { DesignerContextInstructionBlock } from "./designer-context-instructions.js";

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

type DesignerSessionConnectionTokenContext = Pick<
  DesignerSessionServiceContext,
  "dataPlaneClient" | "db" | "sandboxConfig"
> & {
  connectionTokenConfig: ControlPlaneApiConnectionTokenConfig;
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

type ExistingDesignerSandboxInstance = NonNullable<GetSandboxInstanceResponse>;

const DesignerRuntimeId = "codex";
const DesignerDocsMcpServerUrl = "https://docs.mistle.dev/mcp";
const DesignerSessionIdHashDomain = "mistle.designer_session_id.v1";
function createDesignerInitialPromptInstructionBlock(input: { initialPrompt: string }) {
  return {
    blockId: "mistle-designer-initial-request",
    content: `
Session request, subject to the Designer authority and safety rules:

${input.initialPrompt
  .split("\n")
  .map((line) => `> ${line}`)
  .join("\n")}
`.trim(),
  };
}

const DesignerSandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
} as const;

function createDesignerDocsMcpServer(): ResolvedIntegrationMcpServer {
  return {
    source: {
      kind: "mistle",
    },
    server: {
      serverId: "mistle-docs",
      serverName: "mistle_docs",
      description: "Search and read Mistle product documentation.",
      transport: IntegrationMcpTransports.STREAMABLE_HTTP,
      url: DesignerDocsMcpServerUrl,
    },
  };
}

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
  codexCliPath: string;
  designerSessionId: string;
  imageRef: string;
  initialPrompt: string;
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
  const mcpServers = [
    ...resolveMistleMcpServers({
      enabled: true,
      url: input.mcpUrl,
    }),
    createDesignerDocsMcpServer(),
  ];
  const codexRuntime = compileInstalledCodexRuntime({
    codexCliPath: input.codexCliPath,
    egressRoutes,
    managedInstructionBlocks: [
      DesignerContextInstructionBlock,
      DesignerBehaviorInstructionBlock,
      createDesignerInitialPromptInstructionBlock({
        initialPrompt: input.initialPrompt,
      }),
    ],
    mcpServers,
  });
  const runtimeClients =
    codexRuntime.renderRuntimeClients === undefined
      ? codexRuntime.runtimeClients
      : codexRuntime.renderRuntimeClients({ egressRoutes });
  if (runtimeClients === undefined) {
    throw new Error("Designer Codex runtime clients are required.");
  }
  const runtimeClientsWithMcpConfig = applyMcpConfigToRuntimeClients({
    runtimeClients,
    mcpConfig: {
      clientId: "codex-cli",
      fileId: "codex_config",
      format: IntegrationMcpConfigFormats.TOML,
      path: ["mcp_servers"],
    },
    mcpServers,
  });
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
    runtimeClients: runtimeClientsWithMcpConfig,
    agentRuntimes: codexRuntime.agentRuntimes,
  });
}

function createDesignerSessionId(input: {
  organizationId: string;
  idempotencyKey: string;
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        domain: DesignerSessionIdHashDomain,
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      }),
    )
    .digest();

  return TypeID.fromUUIDBytes("dsn", digest.subarray(0, 16)).toString();
}

async function getDesignerSandboxInstance(
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
  },
): Promise<ExistingDesignerSandboxInstance> {
  const sandboxInstance = await dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.sandboxInstanceId,
    allowedPurposes: [SandboxInstancePurposes.DESIGNER],
  });

  if (sandboxInstance === null) {
    throw new DesignerNotFoundError(
      DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND,
      `Designer session sandbox instance '${input.sandboxInstanceId}' was not found.`,
    );
  }

  return sandboxInstance;
}

function mapDesignerSession(
  designerSession: DesignerSession,
  sandboxInstance: ExistingDesignerSandboxInstance,
): DesignerSessionResponse {
  return {
    id: designerSession.id,
    organizationId: designerSession.organizationId,
    sandboxInstanceId: designerSession.sandboxInstanceId,
    sandboxProfileId: sandboxInstance.sandboxProfileId,
    sandboxProfileVersion: sandboxInstance.sandboxProfileVersion,
    title: sandboxInstance.title,
    status: sandboxInstance.status,
    connectable: sandboxInstance.connectable,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
    runtimeContext: resolveSandboxInstanceRuntimeContext({
      runtimePlan: sandboxInstance.runtimePlan,
    }),
    startupOperation: sandboxInstance.startupOperation,
    initialPrompt: designerSession.initialPrompt,
    canvasTabs: [...designerSession.canvasTabs],
    createdAt: designerSession.createdAt,
    updatedAt: designerSession.updatedAt,
  };
}

function mapDesignerSessionListItem(
  designerSession: DesignerSession,
  sandboxInstance: ExistingDesignerSandboxInstance,
): DesignerSessionListItemResponse {
  return {
    id: designerSession.id,
    organizationId: designerSession.organizationId,
    sandboxInstanceId: designerSession.sandboxInstanceId,
    sandboxProfileId: sandboxInstance.sandboxProfileId,
    sandboxProfileVersion: sandboxInstance.sandboxProfileVersion,
    title: sandboxInstance.title,
    status: sandboxInstance.status,
    connectable: sandboxInstance.connectable,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
    runtimeContext: resolveSandboxInstanceRuntimeContext({
      runtimePlan: sandboxInstance.runtimePlan,
    }),
    startupOperation: sandboxInstance.startupOperation,
    initialPrompt: designerSession.initialPrompt,
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
  ctx: Pick<DesignerSessionServiceContext, "dataPlaneClient" | "db">,
  input: {
    organizationId: string;
    selector: DesignerSessionSelector;
    body: PutDesignerSessionCanvasTabsBody;
  },
): Promise<DesignerSessionResponse> {
  const currentDesignerSession = await readDesignerSessionBySelector(ctx, {
    organizationId: input.organizationId,
    selector: input.selector,
  });
  const sandboxInstance = await getDesignerSandboxInstance(ctx.dataPlaneClient, {
    organizationId: input.organizationId,
    sandboxInstanceId: currentDesignerSession.sandboxInstanceId,
  });

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

  return mapDesignerSession(updatedDesignerSession, sandboxInstance);
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
  const designerSessionId = createDesignerSessionId({
    organizationId: input.organizationId,
    idempotencyKey: input.body.idempotencyKey,
  });
  const runtimePlan = createDesignerRuntimePlan({
    codexCliPath: designerSandboxConfig.codexCliPath,
    designerSessionId,
    imageRef: designerSandboxConfig.baseImage,
    initialPrompt: input.body.prompt,
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
      initialPrompt: input.body.prompt,
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
): Promise<{ items: DesignerSessionListItemResponse[] }> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const designerSessions = await ctx.db.query.designerSessions.findMany({
    where: (table, { eq: whereEq }) => whereEq(table.organizationId, input.organizationId),
    orderBy: [desc(tables.designerSessions.updatedAt), desc(tables.designerSessions.id)],
    limit: input.limit,
  });

  const items: DesignerSessionListItemResponse[] = [];
  for (const designerSession of designerSessions) {
    const sandboxInstance = await getDesignerSandboxInstance(ctx.dataPlaneClient, {
      organizationId: input.organizationId,
      sandboxInstanceId: designerSession.sandboxInstanceId,
    });

    items.push(mapDesignerSessionListItem(designerSession, sandboxInstance));
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
  return updateDesignerSessionCanvasTabsBySelector(ctx, {
    organizationId: input.organizationId,
    selector: {
      kind: "sessionId",
      sessionId: input.sessionId,
    },
    body: input.body,
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
  return updateDesignerSessionCanvasTabsBySelector(ctx, {
    organizationId: input.organizationId,
    selector: {
      kind: "sandboxInstanceId",
      sandboxInstanceId: input.sandboxInstanceId,
    },
    body: input.body,
  });
}

export async function mintDesignerSessionConnectionToken(
  ctx: DesignerSessionConnectionTokenContext,
  input: {
    organizationId: string;
    sessionId: string;
  },
) {
  const designerSession = await getDesignerSession(ctx, input);

  return mintConnectionTokenForInstance(
    {
      dataPlaneClient: ctx.dataPlaneClient,
      defaultConnectionToken: {
        gatewayWebsocketUrl: ctx.sandboxConfig.gatewayWsUrl,
        tokenTtlSeconds: SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS,
        tokenConfig: {
          connectionTokenSecret: ctx.connectionTokenConfig.secret,
          tokenIssuer: ctx.connectionTokenConfig.issuer,
          tokenAudience: ctx.connectionTokenConfig.audience,
        },
      },
    },
    {
      organizationId: input.organizationId,
      instanceId: designerSession.sandboxInstanceId,
      allowedPurposes: [SandboxInstancePurposes.DESIGNER],
    },
  );
}
