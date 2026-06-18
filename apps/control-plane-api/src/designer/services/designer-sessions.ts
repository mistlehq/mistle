import { createHash, randomUUID } from "node:crypto";

import type { Cache } from "@mistle/cache";
import type {
  DataPlaneSandboxInstancesClient,
  GetSandboxInstanceResponse,
} from "@mistle/data-plane-internal-client";
import {
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
  type DesignerActionRequest,
  DesignerActionRequestResponses,
  DesignerActionRequestStatuses,
  type DesignerSession,
} from "@mistle/db/control-plane";
import { SandboxInstancePurposes, type SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import {
  AgentConversationStatuses,
  CompiledRuntimePlanSchema,
  type AgentConversationConnection,
  type AgentConversationIdempotencyMetadata,
  type AgentConversationProvider,
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
  ControlPlaneApiConfig,
  ControlPlaneApiConnectionTokenConfig,
  ControlPlaneApiMcpConfig,
  ControlPlaneApiSandboxRuntimeConfig,
} from "../../types.js";
import {
  DESIGNER_RUNTIME_PROFILE_ID,
  DESIGNER_RUNTIME_PROFILE_VERSION,
  DesignerBadRequestCodes,
  DesignerConflictCodes,
  DesignerNotFoundCodes,
} from "../constants.js";
import {
  DesignerBadRequestError,
  DesignerConflictError,
  DesignerNotFoundError,
} from "../errors.js";
import type {
  BootstrapDesignerRuntimeConversationResponse,
  CreateDesignerSessionBody,
  DesignerActionProposal,
  DesignerSessionResponse,
  GetDesignerRuntimeConversationTranscriptResponse,
  PutDesignerSessionCanvasTabsBody,
  SubmitDesignerActionProposalResponseBody,
  SubmitDesignerActionProposalResponseResponse,
  SubmitDesignerRuntimeFollowUpBody,
  SubmitDesignerRuntimeFollowUpResponse,
} from "../schemas.js";
import {
  createDesignerActionProposalResponsePrompt,
  splitDesignerActionProposalsFromTranscriptTurns,
} from "./designer-action-proposals.js";
import {
  claimDesignerActionRequest,
  claimDesignerActionRequestExecution,
  markDesignerActionRequestResponseSubmitted,
  readDesignerActionRequestForResponse,
  toDesignerActionRequestOperation,
  updateDesignerActionRequestExecutionStatus,
} from "./designer-action-requests.js";
import {
  executeApprovedDesignerOperation,
  type DesignerOperationExecutionContext,
} from "./designer-operation-handlers.js";

type DesignerSessionActor = {
  kind: SandboxInstanceStarterKind;
  id: string;
  actingUserId?: string;
};

type ControlPlaneTransaction = Parameters<Parameters<ControlPlaneDatabase["transaction"]>[0]>[0];
type DesignerSessionDatabase = ControlPlaneDatabase | ControlPlaneTransaction;

type DesignerSessionServiceContext = {
  db: ControlPlaneDatabase;
  dataPlaneClient: Pick<
    DataPlaneSandboxInstancesClient,
    "getSandboxInstance" | "resumeSandboxInstance" | "startSandboxInstance"
  >;
  mcpConfig: ControlPlaneApiMcpConfig;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
};

type DesignerRuntimeConversationContext = Pick<DesignerSessionServiceContext, "db"> & {
  cache: Cache;
  connectionTokenConfig: ControlPlaneApiConnectionTokenConfig;
  dataPlaneClient: Pick<
    DataPlaneSandboxInstancesClient,
    "getSandboxInstance" | "resumeSandboxInstance"
  >;
  gatewayWebsocketUrl: string;
  integrationsConfig: Pick<ControlPlaneApiConfig["integrations"], "masterEncryptionKeys">;
};

type DesignerActionProposalResponseContext = DesignerRuntimeConversationContext &
  DesignerOperationExecutionContext;

type LockedDesignerRuntimeConversationContext = Omit<DesignerRuntimeConversationContext, "db"> & {
  db: ControlPlaneTransaction;
};

const DesignerRuntimeSubmissionAdvisoryLockNamespace = 20_260_618;

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
  keySuffix:
    | "create-conversation"
    | "submit-initial-prompt"
    | `submit-follow-up:${string}`
    | `submit-action-proposal-response:${string}:${string}`;
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

function createDesignerRuntimeFollowUpIdempotency(input: {
  designerSessionId: string;
  idempotencyKey: string;
  prompt: string;
  providerConversationId: string;
  sandboxInstanceId: string;
}): AgentConversationIdempotencyMetadata {
  return createDesignerConversationIdempotency({
    designerSessionId: input.designerSessionId,
    operation: "submitPayload",
    keySuffix: `submit-follow-up:${input.idempotencyKey}`,
    fields: {
      designer_session_id: input.designerSessionId,
      idempotency_key: input.idempotencyKey,
      input_text: input.prompt,
      provider_conversation_id: input.providerConversationId,
      sandbox_instance_id: input.sandboxInstanceId,
    },
  });
}

function createDesignerActionProposalResponseIdempotency(input: {
  designerSessionId: string;
  idempotencyKey: string;
  response: SubmitDesignerActionProposalResponseBody["response"];
  proposalId: string;
  providerConversationId: string;
  sandboxInstanceId: string;
}): AgentConversationIdempotencyMetadata {
  return createDesignerConversationIdempotency({
    designerSessionId: input.designerSessionId,
    operation: "submitPayload",
    keySuffix: `submit-action-proposal-response:${input.proposalId}:${input.idempotencyKey}`,
    fields: {
      designer_session_id: input.designerSessionId,
      idempotency_key: input.idempotencyKey,
      provider_conversation_id: input.providerConversationId,
      proposal_id: input.proposalId,
      response: input.response,
      sandbox_instance_id: input.sandboxInstanceId,
    },
  });
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

function mapDesignerActionRequest(
  actionRequest: Pick<DesignerActionRequest, "failureCode" | "failureMessage" | "id" | "status">,
): SubmitDesignerActionProposalResponseResponse["actionRequest"] {
  return {
    id: actionRequest.id,
    status: actionRequest.status,
    failureCode: actionRequest.failureCode,
    failureMessage: actionRequest.failureMessage,
  };
}

function mapSubmittedDesignerActionProposalResponse(input: {
  proposalId: string;
  response: SubmitDesignerActionProposalResponseBody["response"];
  actionRequest: DesignerActionRequest & { responseSubmittedAt: string };
}): SubmitDesignerActionProposalResponseResponse {
  return {
    actionProposalResponse: {
      proposalId: input.proposalId,
      response: input.response,
      providerConversationId: input.actionRequest.runtimeProviderConversationId,
      providerExecutionId: input.actionRequest.runtimeProviderExecutionId,
      submittedAt: input.actionRequest.responseSubmittedAt,
    },
    actionRequest: mapDesignerActionRequest(input.actionRequest),
  };
}

export async function completeApprovedDesignerActionRequestExecution(input: {
  ctx: DesignerOperationExecutionContext;
  organizationId: string;
  actionRequest: DesignerActionRequest;
  response: SubmitDesignerActionProposalResponseResponse;
}): Promise<SubmitDesignerActionProposalResponseResponse> {
  if (
    input.actionRequest.response !== DesignerActionRequestResponses.APPROVED ||
    input.actionRequest.status !== DesignerActionRequestStatuses.APPROVED
  ) {
    return input.response;
  }

  const claimedActionRequest = await claimDesignerActionRequestExecution(input.ctx, {
    organizationId: input.organizationId,
    actionRequestId: input.actionRequest.id,
  });
  if (claimedActionRequest.status !== DesignerActionRequestStatuses.EXECUTING) {
    return {
      ...input.response,
      actionRequest: mapDesignerActionRequest(claimedActionRequest),
    };
  }

  const executionResult = await executeApprovedDesignerOperation(input.ctx, {
    organizationId: input.organizationId,
    requestedByUserId: claimedActionRequest.requestedByUserId,
    operation: claimedActionRequest.operation,
  });
  const actionRequest = await updateDesignerActionRequestExecutionStatus(input.ctx, {
    organizationId: input.organizationId,
    actionRequestId: claimedActionRequest.id,
    status: executionResult.status,
    failureCode: executionResult.failureCode,
    failureMessage: executionResult.failureMessage,
  });

  return {
    ...input.response,
    actionRequest: mapDesignerActionRequest(actionRequest),
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

async function markRuntimeSubmissionSubmitted(
  ctx: { db: DesignerSessionDatabase },
  input: {
    organizationId: string;
    sessionId: string;
  },
): Promise<string> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedRows = await ctx.db
    .update(tables.designerSessions)
    .set({
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.designerSessions.id, input.sessionId),
        eq(tables.designerSessions.organizationId, input.organizationId),
      ),
    )
    .returning({
      updatedAt: tables.designerSessions.updatedAt,
    });

  const updatedAt = updatedRows[0]?.updatedAt;
  if (updatedAt === undefined) {
    throw new DesignerNotFoundError(
      DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND,
      `Designer session '${input.sessionId}' was not found.`,
    );
  }

  return updatedAt;
}

async function acquireDesignerRuntimeSubmissionLock(
  db: DesignerSessionDatabase,
  input: { sessionId: string },
): Promise<boolean> {
  const result = await db.execute(
    sql<{
      acquired: boolean;
    }>`select pg_try_advisory_xact_lock(${DesignerRuntimeSubmissionAdvisoryLockNamespace}, hashtext(${input.sessionId})) as "acquired"`,
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Expected Designer runtime submission advisory lock query to return a row.");
  }

  if (typeof row.acquired !== "boolean") {
    throw new Error("Expected Designer runtime submission advisory lock result to be boolean.");
  }

  return row.acquired;
}

async function mintDesignerRuntimeConnectionToken(
  ctx: DesignerRuntimeConversationContext,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    actingUserId: string;
  },
) {
  return mintConnectionToken(
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
      instanceId: input.sandboxInstanceId,
      actingUserId: input.actingUserId,
    },
  );
}

export async function bootstrapDesignerRuntimeConversation(
  ctx: DesignerRuntimeConversationContext,
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

  const connectionToken = await mintDesignerRuntimeConnectionToken(ctx, {
    organizationId: input.organizationId,
    sandboxInstanceId: designerSession.sandboxInstanceId,
    actingUserId: input.actingUserId,
  });

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

export async function submitDesignerRuntimeFollowUp(
  ctx: Omit<DesignerRuntimeConversationContext, "db"> & { db: ControlPlaneDatabase },
  input: {
    organizationId: string;
    sessionId: string;
    actingUserId: string;
    body: SubmitDesignerRuntimeFollowUpBody;
  },
): Promise<SubmitDesignerRuntimeFollowUpResponse> {
  const designerSession = await readReadyRuntimeConversationDesignerSession(ctx, input);

  const connectionToken = await mintDesignerRuntimeConnectionToken(ctx, {
    organizationId: input.organizationId,
    sandboxInstanceId: designerSession.sandboxInstanceId,
    actingUserId: input.actingUserId,
  });

  return ctx.db.transaction(async (tx) => {
    const lockAcquired = await acquireDesignerRuntimeSubmissionLock(tx, {
      sessionId: input.sessionId,
    });
    if (!lockAcquired) {
      throw new DesignerConflictError(
        DesignerConflictCodes.DESIGNER_RUNTIME_CONVERSATION_BUSY,
        `Designer session '${input.sessionId}' runtime conversation is still processing a previous turn.`,
      );
    }

    return submitDesignerRuntimeFollowUpWithLock(
      {
        ...ctx,
        db: tx,
      },
      {
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        body: input.body,
        connectionUrl: connectionToken.url,
      },
    );
  });
}

export async function submitDesignerActionProposalResponse(
  ctx: DesignerActionProposalResponseContext,
  input: {
    organizationId: string;
    sessionId: string;
    actingUserId: string;
    proposalId: string;
    body: SubmitDesignerActionProposalResponseBody;
  },
): Promise<SubmitDesignerActionProposalResponseResponse> {
  const designerSession = await readReadyRuntimeConversationDesignerSession(ctx, input);
  const existingActionRequest = await readDesignerActionRequestForResponse(ctx, {
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    proposalId: input.proposalId,
    response: input.body.response,
    responseIdempotencyKey: input.body.idempotencyKey,
  });

  if (existingActionRequest !== null && existingActionRequest.responseSubmittedAt !== null) {
    const response = mapSubmittedDesignerActionProposalResponse({
      proposalId: input.proposalId,
      response: input.body.response,
      actionRequest: {
        ...existingActionRequest,
        responseSubmittedAt: existingActionRequest.responseSubmittedAt,
      },
    });

    return completeApprovedDesignerActionRequestExecution({
      ctx,
      organizationId: input.organizationId,
      actionRequest: existingActionRequest,
      response,
    });
  }

  const connectionToken = await mintDesignerRuntimeConnectionToken(ctx, {
    organizationId: input.organizationId,
    sandboxInstanceId: designerSession.sandboxInstanceId,
    actingUserId: input.actingUserId,
  });

  const submittedResponse = await ctx.db.transaction(async (tx) => {
    const lockAcquired = await acquireDesignerRuntimeSubmissionLock(tx, {
      sessionId: input.sessionId,
    });
    if (!lockAcquired) {
      throw new DesignerConflictError(
        DesignerConflictCodes.DESIGNER_RUNTIME_CONVERSATION_BUSY,
        `Designer session '${input.sessionId}' runtime conversation is still processing a previous turn.`,
      );
    }

    const lockedExistingActionRequest = await readDesignerActionRequestForResponse(
      {
        db: tx,
      },
      {
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        proposalId: input.proposalId,
        response: input.body.response,
        responseIdempotencyKey: input.body.idempotencyKey,
      },
    );

    if (lockedExistingActionRequest !== null) {
      if (lockedExistingActionRequest.responseSubmittedAt !== null) {
        return {
          actionRequest: lockedExistingActionRequest,
          response: mapSubmittedDesignerActionProposalResponse({
            proposalId: input.proposalId,
            response: input.body.response,
            actionRequest: {
              ...lockedExistingActionRequest,
              responseSubmittedAt: lockedExistingActionRequest.responseSubmittedAt,
            },
          }),
        };
      }

      const response = await submitDesignerActionProposalResponseTurn(
        {
          ...ctx,
          db: tx,
        },
        {
          organizationId: input.organizationId,
          sessionId: input.sessionId,
          proposalId: input.proposalId,
          body: input.body,
          connectionUrl: connectionToken.url,
          actionRequest: lockedExistingActionRequest,
        },
      );

      return {
        actionRequest: lockedExistingActionRequest,
        response,
      };
    }

    const claimed = await claimDesignerActionProposalResponseWithLock(
      {
        ...ctx,
        db: tx,
      },
      {
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        actingUserId: input.actingUserId,
        proposalId: input.proposalId,
        body: input.body,
        connectionUrl: connectionToken.url,
      },
    );
    const response = await submitDesignerActionProposalResponseTurn(
      {
        ...ctx,
        db: tx,
      },
      {
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        proposalId: input.proposalId,
        body: input.body,
        connectionUrl: connectionToken.url,
        actionRequest: claimed,
      },
    );

    return {
      actionRequest: claimed,
      response,
    };
  });

  return completeApprovedDesignerActionRequestExecution({
    ctx,
    organizationId: input.organizationId,
    actionRequest: submittedResponse.actionRequest,
    response: submittedResponse.response,
  });
}

export async function getDesignerRuntimeConversationTranscript(
  ctx: DesignerRuntimeConversationContext,
  input: {
    organizationId: string;
    sessionId: string;
    actingUserId: string;
  },
): Promise<GetDesignerRuntimeConversationTranscriptResponse> {
  const designerSession = await readReadyRuntimeConversationDesignerSession(ctx, input);
  const connectionToken = await mintDesignerRuntimeConnectionToken(ctx, {
    organizationId: input.organizationId,
    sandboxInstanceId: designerSession.sandboxInstanceId,
    actingUserId: input.actingUserId,
  });

  const provider = resolveAgentConversationProvider(DesignerRuntimeId);
  if (provider.readConversationTranscript === undefined) {
    throw new Error(
      `Agent runtime '${DesignerRuntimeId}' does not support runtime conversation transcript reads.`,
    );
  }

  const connection = await provider.connect({
    connectionUrl: connectionToken.url,
  });

  try {
    await provider.resumeConversation({
      connection,
      providerConversationId: designerSession.runtimeProviderConversationId,
    });
    const transcript = await provider.readConversationTranscript({
      connection,
      providerConversationId: designerSession.runtimeProviderConversationId,
    });
    const splitTranscript = splitDesignerActionProposalsFromTranscriptTurns(transcript.turns);

    return {
      runtimeConversationTranscript: {
        providerConversationId: transcript.providerConversationId,
        name: transcript.name,
        preview: transcript.preview,
        turns: splitTranscript.turns,
        actionProposals: splitTranscript.actionProposals,
      },
    };
  } finally {
    await connection.close();
  }
}

async function submitDesignerRuntimeFollowUpWithLock(
  ctx: LockedDesignerRuntimeConversationContext,
  input: {
    organizationId: string;
    sessionId: string;
    body: SubmitDesignerRuntimeFollowUpBody;
    connectionUrl: string;
  },
): Promise<SubmitDesignerRuntimeFollowUpResponse> {
  const submission = await submitDesignerRuntimeConversationInputWithLock(ctx, {
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    connectionUrl: input.connectionUrl,
    inputText: input.body.prompt,
    createIdempotency: (designerSession, providerConversationId) =>
      createDesignerRuntimeFollowUpIdempotency({
        designerSessionId: designerSession.id,
        idempotencyKey: input.body.idempotencyKey,
        prompt: input.body.prompt,
        providerConversationId,
        sandboxInstanceId: designerSession.sandboxInstanceId,
      }),
  });

  return {
    runtimeFollowUp: submission,
  };
}

async function claimDesignerActionProposalResponseWithLock(
  ctx: LockedDesignerRuntimeConversationContext,
  input: {
    organizationId: string;
    sessionId: string;
    actingUserId: string;
    proposalId: string;
    body: SubmitDesignerActionProposalResponseBody;
    connectionUrl: string;
  },
): Promise<DesignerActionRequest> {
  const designerSession = await readReadyRuntimeConversationDesignerSession(ctx, input);
  const providerConversationId = designerSession.runtimeProviderConversationId;
  const provider = resolveAgentConversationProvider(DesignerRuntimeId);
  const connection = await provider.connect({
    connectionUrl: input.connectionUrl,
  });

  try {
    await provider.resumeConversation({
      connection,
      providerConversationId,
    });

    const runtimeConversation = await provider.inspectConversation({
      connection,
      providerConversationId,
    });
    if (runtimeConversation.status === AgentConversationStatuses.ACTIVE) {
      throw new DesignerConflictError(
        DesignerConflictCodes.DESIGNER_RUNTIME_CONVERSATION_BUSY,
        `Designer session '${input.sessionId}' runtime conversation is still processing a previous turn.`,
      );
    }

    const proposal = await assertPendingDesignerActionProposal({
      provider,
      connection,
      providerConversationId,
      proposalId: input.proposalId,
    });
    const claimedActionRequest = await claimDesignerActionRequest(ctx, {
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      proposalId: input.proposalId,
      response: input.body.response,
      responseIdempotencyKey: input.body.idempotencyKey,
      requestedByUserId: input.actingUserId,
      runtimeProviderConversationId: providerConversationId,
      operation: toDesignerActionRequestOperation(proposal.operation),
    });

    return claimedActionRequest.actionRequest;
  } finally {
    await connection.close();
  }
}

async function submitDesignerActionProposalResponseTurn(
  ctx: LockedDesignerRuntimeConversationContext,
  input: {
    organizationId: string;
    sessionId: string;
    proposalId: string;
    body: SubmitDesignerActionProposalResponseBody;
    connectionUrl: string;
    actionRequest: DesignerActionRequest;
  },
): Promise<SubmitDesignerActionProposalResponseResponse> {
  const responsePrompt = createDesignerActionProposalResponsePrompt({
    proposalId: input.proposalId,
    response: input.body.response,
  });
  const submission = await submitDesignerRuntimeConversationInputWithLock(ctx, {
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    connectionUrl: input.connectionUrl,
    inputText: responsePrompt,
    createIdempotency: (designerSession, providerConversationId) =>
      createDesignerActionProposalResponseIdempotency({
        designerSessionId: designerSession.id,
        idempotencyKey: input.body.idempotencyKey,
        response: input.body.response,
        proposalId: input.proposalId,
        providerConversationId,
        sandboxInstanceId: designerSession.sandboxInstanceId,
      }),
  });
  const submittedActionRequest = await markDesignerActionRequestResponseSubmitted(ctx, {
    organizationId: input.organizationId,
    actionRequestId: input.actionRequest.id,
    runtimeProviderExecutionId: submission.providerExecutionId,
    responseSubmittedAt: submission.submittedAt,
  });

  return {
    actionProposalResponse: {
      proposalId: input.proposalId,
      response: input.body.response,
      ...submission,
    },
    actionRequest: mapDesignerActionRequest(submittedActionRequest),
  };
}

async function submitDesignerRuntimeConversationInputWithLock(
  ctx: LockedDesignerRuntimeConversationContext,
  input: {
    organizationId: string;
    sessionId: string;
    connectionUrl: string;
    inputText: string;
    createIdempotency: (
      designerSession: DesignerSession,
      providerConversationId: string,
    ) => AgentConversationIdempotencyMetadata;
  },
): Promise<{
  providerConversationId: string;
  providerExecutionId: string | null;
  submittedAt: string;
}> {
  const designerSession = await readReadyRuntimeConversationDesignerSession(ctx, input);
  const providerConversationId = designerSession.runtimeProviderConversationId;
  const provider = resolveAgentConversationProvider(DesignerRuntimeId);
  const connection = await provider.connect({
    connectionUrl: input.connectionUrl,
  });

  try {
    await provider.resumeConversation({
      connection,
      providerConversationId,
    });

    const runtimeConversation = await provider.inspectConversation({
      connection,
      providerConversationId,
    });
    if (runtimeConversation.status === AgentConversationStatuses.ACTIVE) {
      throw new DesignerConflictError(
        DesignerConflictCodes.DESIGNER_RUNTIME_CONVERSATION_BUSY,
        `Designer session '${input.sessionId}' runtime conversation is still processing a previous turn.`,
      );
    }

    const submittedTurn = await provider.startExecution({
      connection,
      providerConversationId,
      inputText: input.inputText,
      idempotency: input.createIdempotency(designerSession, providerConversationId),
    });

    return {
      providerConversationId,
      providerExecutionId: submittedTurn.providerExecutionId,
      submittedAt: await markRuntimeSubmissionSubmitted(ctx, {
        organizationId: input.organizationId,
        sessionId: designerSession.id,
      }),
    };
  } finally {
    await connection.close();
  }
}

async function assertPendingDesignerActionProposal(input: {
  provider: AgentConversationProvider;
  connection: AgentConversationConnection;
  providerConversationId: string;
  proposalId: string;
}): Promise<DesignerActionProposal> {
  if (input.provider.readConversationTranscript === undefined) {
    throw new Error(
      `Agent runtime '${DesignerRuntimeId}' does not support runtime conversation transcript reads.`,
    );
  }

  const transcript = await input.provider.readConversationTranscript({
    connection: input.connection,
    providerConversationId: input.providerConversationId,
  });
  const splitTranscript = splitDesignerActionProposalsFromTranscriptTurns(transcript.turns);
  const proposal = splitTranscript.actionProposals.find(
    (candidate) => candidate.id === input.proposalId,
  );

  if (proposal === undefined) {
    throw new DesignerNotFoundError(
      DesignerNotFoundCodes.DESIGNER_ACTION_PROPOSAL_NOT_FOUND,
      `Designer action proposal '${input.proposalId}' was not found.`,
    );
  }

  if (proposal.status !== "pending") {
    throw new DesignerConflictError(
      DesignerConflictCodes.DESIGNER_ACTION_PROPOSAL_NOT_PENDING,
      `Designer action proposal '${input.proposalId}' is not pending.`,
    );
  }

  return proposal;
}

async function readReadyRuntimeConversationDesignerSession(
  ctx: { db: DesignerSessionDatabase },
  input: {
    organizationId: string;
    sessionId: string;
  },
): Promise<
  DesignerSession & {
    runtimeProviderConversationId: string;
    initialPromptSubmittedAt: string;
  }
> {
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

  const providerConversationId = designerSession.runtimeProviderConversationId;
  const initialPromptSubmittedAt = designerSession.initialPromptSubmittedAt;
  if (providerConversationId === null || initialPromptSubmittedAt === null) {
    throw new DesignerConflictError(
      DesignerConflictCodes.DESIGNER_RUNTIME_CONVERSATION_NOT_READY,
      `Designer session '${input.sessionId}' runtime conversation is not ready for follow-up submission.`,
    );
  }

  return {
    ...designerSession,
    runtimeProviderConversationId: providerConversationId,
    initialPromptSubmittedAt,
  };
}
