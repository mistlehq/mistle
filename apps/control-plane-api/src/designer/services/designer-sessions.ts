import { createHash, randomUUID } from "node:crypto";

import type { Cache } from "@mistle/cache";
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
  type AgentConversationIdempotencyMetadata,
  type EgressCredentialRoute,
  SandboxImageSources,
  createDisabledAssociatedResourceEventRouting,
} from "@mistle/integrations-core";
import { compileInstalledCodexRuntime } from "@mistle/integrations-definitions/agent-runtimes/codex";
import { resolveAgentConversationProvider } from "@mistle/integrations-definitions/agent-runtimes/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { typeid } from "typeid-js";

import { mintConnectionToken } from "../../internal/sandbox-runtime/services/mint-connection-token.js";
import { SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS } from "../../sandbox-instances/constants.js";
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
  BootstrapDesignerRuntimeConversationResponse,
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
    "getSandboxInstance" | "resumeSandboxInstance" | "startSandboxInstance"
  >;
  mcpConfig: ControlPlaneApiMcpConfig;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
};

type BootstrapDesignerRuntimeConversationContext = Pick<DesignerSessionServiceContext, "db"> & {
  cache: Cache;
  connectionTokenConfig: ControlPlaneApiConnectionTokenConfig;
  dataPlaneClient: Pick<
    DataPlaneSandboxInstancesClient,
    "getSandboxInstance" | "resumeSandboxInstance"
  >;
  gatewayWebsocketUrl: string;
  integrationsConfig: {
    masterEncryptionKeys: Record<string, string>;
  };
};

type RuntimeConversationBootstrapResult = {
  providerConversationId: string;
  providerExecutionId: string | null;
  initialPromptSubmittedAt: string;
};

const DesignerRuntimeId = "codex";
const DesignerRuntimeWorkingDirectory = "/root";

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

function createRuntimeRequestFingerprint(input: {
  operation: AgentConversationIdempotencyMetadata["operation"];
  fields: Record<string, string>;
}): string {
  const payload = {
    version: 1,
    runtime_id: DesignerRuntimeId,
    operation: input.operation,
    fields: Object.fromEntries(
      Object.entries(input.fields).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `sha256:${digest}`;
}

function createDesignerConversationIdempotency(input: {
  designerSessionId: string;
  operation: AgentConversationIdempotencyMetadata["operation"];
  keySuffix: "create-conversation" | "submit-initial-prompt";
  fields: Record<string, string>;
}): AgentConversationIdempotencyMetadata {
  return {
    key: `designer-runtime-conversation:${input.designerSessionId}:${input.keySuffix}`,
    operation: input.operation,
    requestFingerprint: createRuntimeRequestFingerprint({
      operation: input.operation,
      fields: input.fields,
    }),
  };
}

function mapRuntimeConversationBootstrapResult(
  result: RuntimeConversationBootstrapResult,
): BootstrapDesignerRuntimeConversationResponse {
  return {
    runtimeConversation: {
      providerConversationId: result.providerConversationId,
      providerExecutionId: result.providerExecutionId,
      initialPromptSubmittedAt: result.initialPromptSubmittedAt,
    },
  };
}

function createDesignerRuntimePlan(input: {
  codexCliPath: string;
  designerSessionId: string;
  imageRef: string;
  mcpUrl: string;
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
  const codexRuntime = compileInstalledCodexRuntime({
    codexCliPath: input.codexCliPath,
    egressRoutes,
    mcpServers,
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
    artifacts: codexRuntime.artifacts,
    workspaceSources: [],
    runtimeClients: codexRuntime.runtimeClients,
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
    initialPrompt: designerSession.initialPrompt,
    title: sandboxInstance?.title ?? null,
    status: sandboxInstance?.status ?? null,
    connectable: sandboxInstance?.connectable ?? false,
    failureCode: sandboxInstance?.failureCode ?? null,
    failureMessage: sandboxInstance?.failureMessage ?? null,
    canvasTabs: [...designerSession.canvasTabs],
    createdAt: designerSession.createdAt,
    updatedAt: designerSession.updatedAt,
  };
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
    codexCliPath: designerSandboxConfig.codexCliPath,
    designerSessionId,
    imageRef: designerSandboxConfig.baseImage,
    mcpUrl: ctx.mcpConfig.url,
  });
  const startedSandbox = await ctx.dataPlaneClient.startSandboxInstance({
    organizationId: input.organizationId,
    sandboxProfileId: DESIGNER_RUNTIME_PROFILE_ID,
    sandboxProfileVersion: DESIGNER_RUNTIME_PROFILE_VERSION,
    purpose: SandboxInstancePurposes.DESIGNER,
    idempotencyKey: input.body.idempotencyKey ?? randomUUID(),
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
    const existingDesignerSession = await ctx.db.query.designerSessions.findFirst({
      where: (table, { and, eq: whereEq }) =>
        and(
          whereEq(table.organizationId, input.organizationId),
          whereEq(table.sandboxInstanceId, startedSandbox.sandboxInstanceId),
        ),
    });

    if (existingDesignerSession === undefined) {
      throw new Error("Expected existing designer session after sandbox instance conflict.");
    }

    const sandboxInstance = await getDesignerSandboxInstance(ctx.dataPlaneClient, {
      organizationId: input.organizationId,
      sandboxInstanceId: existingDesignerSession.sandboxInstanceId,
    });

    return mapDesignerSession(existingDesignerSession, sandboxInstance);
  }

  const sandboxInstance = await getDesignerSandboxInstance(ctx.dataPlaneClient, {
    organizationId: input.organizationId,
    sandboxInstanceId: createdDesignerSession.sandboxInstanceId,
  });

  return mapDesignerSession(createdDesignerSession, sandboxInstance);
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
    const sandboxInstance = await getDesignerSandboxInstance(ctx.dataPlaneClient, {
      organizationId: input.organizationId,
      sandboxInstanceId: designerSession.sandboxInstanceId,
    });

    items.push(mapDesignerSession(designerSession, sandboxInstance));
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
  const designerSession = await ctx.db.query.designerSessions.findFirst({
    where: (table, { and, eq: whereEq }) =>
      and(whereEq(table.id, input.sessionId), whereEq(table.organizationId, input.organizationId)),
  });

  if (designerSession === undefined) {
    throw new DesignerNotFoundError(
      DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND,
      `Designer session '${input.sessionId}' was not found.`,
    );
  }

  const sandboxInstance = await getDesignerSandboxInstance(ctx.dataPlaneClient, {
    organizationId: input.organizationId,
    sandboxInstanceId: designerSession.sandboxInstanceId,
  });

  return mapDesignerSession(designerSession, sandboxInstance);
}

export async function putDesignerSessionCanvasTabs(
  ctx: Pick<DesignerSessionServiceContext, "db" | "dataPlaneClient">,
  input: {
    organizationId: string;
    sessionId: string;
    body: PutDesignerSessionCanvasTabsBody;
  },
): Promise<DesignerSessionResponse> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedDesignerSessionRows = await ctx.db
    .update(tables.designerSessions)
    .set({
      canvasTabs: input.body.tabs,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.designerSessions.id, input.sessionId),
        eq(tables.designerSessions.organizationId, input.organizationId),
      ),
    )
    .returning();

  const updatedDesignerSession = updatedDesignerSessionRows[0];
  if (updatedDesignerSession === undefined) {
    throw new DesignerNotFoundError(
      DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND,
      `Designer session '${input.sessionId}' was not found.`,
    );
  }

  const sandboxInstance = await getDesignerSandboxInstance(ctx.dataPlaneClient, {
    organizationId: input.organizationId,
    sandboxInstanceId: updatedDesignerSession.sandboxInstanceId,
  });

  return mapDesignerSession(updatedDesignerSession, sandboxInstance);
}

function readCompletedRuntimeConversation(
  designerSession: Pick<
    DesignerSession,
    | "initialPromptProviderExecutionId"
    | "initialPromptSubmittedAt"
    | "runtimeProviderConversationId"
  >,
): RuntimeConversationBootstrapResult | null {
  if (
    designerSession.runtimeProviderConversationId === null ||
    designerSession.initialPromptSubmittedAt === null
  ) {
    return null;
  }

  return {
    providerConversationId: designerSession.runtimeProviderConversationId,
    providerExecutionId: designerSession.initialPromptProviderExecutionId,
    initialPromptSubmittedAt: designerSession.initialPromptSubmittedAt,
  };
}

async function persistRuntimeProviderConversationId(
  ctx: Pick<DesignerSessionServiceContext, "db">,
  input: {
    organizationId: string;
    sessionId: string;
    providerConversationId: string;
  },
): Promise<string> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedRows = await ctx.db
    .update(tables.designerSessions)
    .set({
      runtimeProviderConversationId: input.providerConversationId,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.designerSessions.id, input.sessionId),
        eq(tables.designerSessions.organizationId, input.organizationId),
        sql`${tables.designerSessions.runtimeProviderConversationId} is null`,
      ),
    )
    .returning({
      runtimeProviderConversationId: tables.designerSessions.runtimeProviderConversationId,
    });

  const updatedRuntimeProviderConversationId = updatedRows[0]?.runtimeProviderConversationId;
  if (
    updatedRuntimeProviderConversationId !== undefined &&
    updatedRuntimeProviderConversationId !== null
  ) {
    return updatedRuntimeProviderConversationId;
  }

  const designerSession = await ctx.db.query.designerSessions.findFirst({
    columns: {
      runtimeProviderConversationId: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.sessionId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (designerSession === undefined) {
    throw new DesignerNotFoundError(
      DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND,
      `Designer session '${input.sessionId}' was not found.`,
    );
  }

  if (designerSession.runtimeProviderConversationId === null) {
    throw new Error(
      `Designer session '${input.sessionId}' runtime conversation id was not persisted.`,
    );
  }

  return designerSession.runtimeProviderConversationId;
}

async function persistInitialPromptSubmission(
  ctx: Pick<DesignerSessionServiceContext, "db">,
  input: {
    organizationId: string;
    sessionId: string;
    providerExecutionId: string | null;
  },
): Promise<RuntimeConversationBootstrapResult> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedRows = await ctx.db
    .update(tables.designerSessions)
    .set({
      initialPromptProviderExecutionId: input.providerExecutionId,
      initialPromptSubmittedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.designerSessions.id, input.sessionId),
        eq(tables.designerSessions.organizationId, input.organizationId),
        sql`${tables.designerSessions.initialPromptSubmittedAt} is null`,
      ),
    )
    .returning({
      runtimeProviderConversationId: tables.designerSessions.runtimeProviderConversationId,
      initialPromptProviderExecutionId: tables.designerSessions.initialPromptProviderExecutionId,
      initialPromptSubmittedAt: tables.designerSessions.initialPromptSubmittedAt,
    });

  const updated = updatedRows[0];
  if (
    updated !== undefined &&
    updated.runtimeProviderConversationId !== null &&
    updated.initialPromptSubmittedAt !== null
  ) {
    return {
      providerConversationId: updated.runtimeProviderConversationId,
      providerExecutionId: updated.initialPromptProviderExecutionId,
      initialPromptSubmittedAt: updated.initialPromptSubmittedAt,
    };
  }

  const designerSession = await ctx.db.query.designerSessions.findFirst({
    columns: {
      runtimeProviderConversationId: true,
      initialPromptProviderExecutionId: true,
      initialPromptSubmittedAt: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.sessionId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (designerSession === undefined) {
    throw new DesignerNotFoundError(
      DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND,
      `Designer session '${input.sessionId}' was not found.`,
    );
  }

  const completed = readCompletedRuntimeConversation(designerSession);
  if (completed === null) {
    throw new Error(
      `Designer session '${input.sessionId}' runtime conversation bootstrap did not persist a completed initial prompt submission.`,
    );
  }

  return completed;
}

export async function bootstrapDesignerRuntimeConversation(
  ctx: BootstrapDesignerRuntimeConversationContext,
  input: {
    organizationId: string;
    sessionId: string;
    actingUserId: string;
  },
): Promise<BootstrapDesignerRuntimeConversationResponse> {
  const designerSession = await ctx.db.query.designerSessions.findFirst({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.sessionId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (designerSession === undefined) {
    throw new DesignerNotFoundError(
      DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND,
      `Designer session '${input.sessionId}' was not found.`,
    );
  }

  const completedRuntimeConversation = readCompletedRuntimeConversation(designerSession);
  if (completedRuntimeConversation !== null) {
    return mapRuntimeConversationBootstrapResult(completedRuntimeConversation);
  }

  if (designerSession.initialPrompt === null) {
    throw new DesignerBadRequestError(
      DesignerBadRequestCodes.DESIGNER_INITIAL_PROMPT_MISSING,
      `Designer session '${input.sessionId}' does not have an initial prompt to submit.`,
    );
  }

  const connectionToken = await mintConnectionToken(
    {
      db: ctx.db,
      cache: ctx.cache,
      integrationsConfig: ctx.integrationsConfig,
      dataPlaneClient: ctx.dataPlaneClient,
      gatewayWebsocketUrl: ctx.gatewayWebsocketUrl,
      tokenTtlSeconds: SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS,
      tokenConfig: {
        connectionTokenSecret: ctx.connectionTokenConfig.secret,
        tokenIssuer: ctx.connectionTokenConfig.issuer,
        tokenAudience: ctx.connectionTokenConfig.audience,
      },
    },
    {
      organizationId: input.organizationId,
      instanceId: designerSession.sandboxInstanceId,
      actingUserId: input.actingUserId,
    },
  );

  const provider = resolveAgentConversationProvider(DesignerRuntimeId);
  const connection = await provider.connect({
    connectionUrl: connectionToken.url,
  });

  try {
    let providerConversationId = designerSession.runtimeProviderConversationId;
    if (providerConversationId === null) {
      const createdConversation = await provider.createConversation({
        connection,
        cwd: DesignerRuntimeWorkingDirectory,
        idempotency: createDesignerConversationIdempotency({
          designerSessionId: designerSession.id,
          operation: "createConversation",
          keySuffix: "create-conversation",
          fields: {
            designer_session_id: designerSession.id,
            sandbox_instance_id: designerSession.sandboxInstanceId,
            working_directory: DesignerRuntimeWorkingDirectory,
          },
        }),
      });
      providerConversationId = await persistRuntimeProviderConversationId(ctx, {
        organizationId: input.organizationId,
        sessionId: designerSession.id,
        providerConversationId: createdConversation.providerConversationId,
      });
    } else {
      await provider.resumeConversation({
        connection,
        providerConversationId,
      });
    }

    const submittedPrompt = await provider.startExecution({
      connection,
      providerConversationId,
      inputText: designerSession.initialPrompt,
      idempotency: createDesignerConversationIdempotency({
        designerSessionId: designerSession.id,
        operation: "submitPayload",
        keySuffix: "submit-initial-prompt",
        fields: {
          designer_session_id: designerSession.id,
          input_text: designerSession.initialPrompt,
          provider_conversation_id: providerConversationId,
          sandbox_instance_id: designerSession.sandboxInstanceId,
        },
      }),
    });

    return mapRuntimeConversationBootstrapResult(
      await persistInitialPromptSubmission(ctx, {
        organizationId: input.organizationId,
        sessionId: designerSession.id,
        providerExecutionId: submittedPrompt.providerExecutionId,
      }),
    );
  } finally {
    await connection.close();
  }
}
