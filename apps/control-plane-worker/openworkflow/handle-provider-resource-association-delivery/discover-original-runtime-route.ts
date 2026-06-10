import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  TriggerConversationCreatedByKinds,
  TriggerConversationOwnerKinds,
  TriggerConversationRouteStatuses,
  TriggerConversationStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import {
  AllCodexThreadSourceKinds,
  parseCodexThreadListResponse,
  resolveOriginalCodexThreadId,
  type CodexThreadSummary,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { sql } from "drizzle-orm";

import {
  getConversationProviderAdapter,
  type ProviderConnection,
} from "../handle-trigger-conversation-delivery/provider-adapter.js";
import { acquireProviderResourceAssociationDeliveryConnection } from "./acquire-connection.js";
import {
  ProviderResourceAssociationDeliveryError,
  ProviderResourceAssociationDeliveryFailureCodes,
} from "./errors.js";
import type { ResolvedProviderResourceAssociationDeliveryRoute } from "./resolve-route.js";

const OriginalCodexThreadListPageSize = 100;

type ProviderResourceAssociationDeliveryRouteDiscoveryInput = {
  deliveryId: string;
  providerResourceAssociationId: string;
  sourceWebhookEventId: string;
};

type ProviderResourceAssociationRouteDiscoveryScope = {
  integrationConnectionId: string;
  integrationFamilyId: string;
  organizationId: string;
  sandboxInstanceId: string;
  sandboxProfileId: string;
  runtimeContext: {
    runtimeId: string;
    workingDirectory: string;
  };
};

export async function discoverOriginalRuntimeProviderResourceAssociationDeliveryRoute(
  ctx: {
    controlPlaneInternalClient: Pick<
      ControlPlaneInternalClient,
      "getSandboxInstance" | "mintSandboxConnectionToken" | "resumeSandboxInstanceForConnection"
    >;
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
    db: ControlPlaneDatabase;
  },
  input: ProviderResourceAssociationDeliveryRouteDiscoveryInput,
): Promise<ResolvedProviderResourceAssociationDeliveryRoute> {
  const scope = await resolveDiscoveryScope(ctx, input);
  if (scope.runtimeContext.runtimeId !== "codex") {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.ROUTING_CONVERSATION_NOT_FOUND,
      message: `Provider resource association '${input.providerResourceAssociationId}' cannot derive an original runtime conversation for non-Codex runtime '${scope.runtimeContext.runtimeId}'.`,
    });
  }

  const conversationId = await ensureProviderResourceAssociationConversation(ctx.db, {
    ...scope,
    providerResourceAssociationId: input.providerResourceAssociationId,
    sourceWebhookEventId: input.sourceWebhookEventId,
  });
  const webhookEvent = await ctx.db.query.integrationWebhookEvents.findFirst({
    columns: {
      externalDeliveryId: true,
    },
    where: (table, { eq }) => eq(table.id, input.sourceWebhookEventId),
  });
  if (webhookEvent === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.DELIVERY_NOT_FOUND,
      message: `Provider resource association delivery '${input.deliveryId}' references missing webhook event '${input.sourceWebhookEventId}'.`,
    });
  }

  const connection = await acquireProviderResourceAssociationDeliveryConnection(
    {
      controlPlaneInternalClient: ctx.controlPlaneInternalClient,
    },
    {
      organizationId: scope.organizationId,
      sandboxInstanceId: scope.sandboxInstanceId,
      deliveryId: input.deliveryId,
      conversationId,
      webhookEventId: input.sourceWebhookEventId,
      ...(webhookEvent.externalDeliveryId === null
        ? {}
        : { externalDeliveryId: webhookEvent.externalDeliveryId }),
    },
  );
  const providerConversationId = await discoverOriginalCodexProviderConversationId({
    connectionUrl: connection.url,
  });
  const route = await ensureProviderResourceAssociationConversationRoute(ctx.db, {
    conversationId,
    providerConversationId,
    sandboxInstanceId: scope.sandboxInstanceId,
  });

  return {
    organizationId: scope.organizationId,
    providerResourceAssociationId: input.providerResourceAssociationId,
    sandboxInstanceId: scope.sandboxInstanceId,
    conversationId,
    routeId: route.routeId,
    runtimeId: scope.runtimeContext.runtimeId,
    workingDirectory: scope.runtimeContext.workingDirectory,
    providerConversationId,
    providerExecutionId: route.providerExecutionId,
  };
}

async function resolveDiscoveryScope(
  ctx: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
    db: ControlPlaneDatabase;
  },
  input: Pick<
    ProviderResourceAssociationDeliveryRouteDiscoveryInput,
    "providerResourceAssociationId"
  >,
): Promise<ProviderResourceAssociationRouteDiscoveryScope> {
  const association = await ctx.db.query.providerResourceAssociations.findFirst({
    columns: {
      id: true,
      integrationConnectionId: true,
      sandboxInstanceId: true,
    },
    where: (table, { eq }) => eq(table.id, input.providerResourceAssociationId),
  });
  if (association === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.ASSOCIATION_NOT_FOUND,
      message: `Provider resource association '${input.providerResourceAssociationId}' was not found.`,
    });
  }

  const integrationConnection = await ctx.db.query.integrationConnections.findFirst({
    columns: {
      organizationId: true,
      targetKey: true,
    },
    where: (table, { eq }) => eq(table.id, association.integrationConnectionId),
  });
  if (integrationConnection === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.ASSOCIATION_NOT_FOUND,
      message: `Provider resource association '${association.id}' references missing integration connection '${association.integrationConnectionId}'.`,
    });
  }

  const integrationTarget = await ctx.db.query.integrationTargets.findFirst({
    columns: {
      familyId: true,
    },
    where: (table, { eq }) => eq(table.targetKey, integrationConnection.targetKey),
  });
  if (integrationTarget === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.ASSOCIATION_NOT_FOUND,
      message: `Provider resource association '${association.id}' references missing integration target '${integrationConnection.targetKey}'.`,
    });
  }

  const sandboxInstance = await ctx.dataPlaneClient.getSandboxInstance({
    organizationId: integrationConnection.organizationId,
    instanceId: association.sandboxInstanceId,
  });
  if (sandboxInstance === null) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.SANDBOX_NOT_FOUND,
      message: `Provider resource association '${association.id}' references missing sandbox instance '${association.sandboxInstanceId}'.`,
    });
  }
  if (sandboxInstance.runtimePlan === null) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.RUNTIME_PLAN_NOT_FOUND,
      message: `Sandbox instance '${association.sandboxInstanceId}' does not have a persisted runtime plan.`,
    });
  }

  return {
    integrationConnectionId: association.integrationConnectionId,
    integrationFamilyId: integrationTarget.familyId,
    organizationId: integrationConnection.organizationId,
    sandboxInstanceId: association.sandboxInstanceId,
    sandboxProfileId: sandboxInstance.sandboxProfileId,
    runtimeContext: resolveOriginalCodexRuntimeContext(sandboxInstance.runtimePlan),
  };
}

function resolveOriginalCodexRuntimeContext(runtimePlan: CompiledRuntimePlan): {
  runtimeId: string;
  workingDirectory: string;
} {
  const agentRuntime = runtimePlan.agentRuntimes.find(
    (candidate) => candidate.runtimeId === "codex",
  );
  if (agentRuntime === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.RUNTIME_PLAN_AGENT_RUNTIME_NOT_FOUND,
      message: "Associated sandbox runtime plan does not define a Codex agent runtime.",
    });
  }

  const workingDirectory =
    agentRuntime.ptyLaunch.newLaunch.cwd ?? agentRuntime.ptyLaunch.resumeLaunch.cwd;
  if (workingDirectory === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.RUNTIME_PLAN_WORKING_DIRECTORY_NOT_FOUND,
      message: `Associated sandbox runtime '${agentRuntime.runtimeId}' does not define a working directory.`,
    });
  }

  return {
    runtimeId: agentRuntime.runtimeId,
    workingDirectory,
  };
}

async function ensureProviderResourceAssociationConversation(
  db: ControlPlaneDatabase,
  input: ProviderResourceAssociationRouteDiscoveryScope & {
    providerResourceAssociationId: string;
    sourceWebhookEventId: string;
  },
): Promise<string> {
  const tables = getControlPlaneDatabaseSchema(db);
  const conversationKey = createProviderResourceAssociationConversationKey({
    providerResourceAssociationId: input.providerResourceAssociationId,
  });
  const insertedRows = await db
    .insert(tables.triggerConversations)
    .values({
      organizationId: input.organizationId,
      ownerKind: TriggerConversationOwnerKinds.PROVIDER_RESOURCE_ASSOCIATION,
      ownerId: input.providerResourceAssociationId,
      createdByKind: TriggerConversationCreatedByKinds.WEBHOOK,
      createdById: input.sourceWebhookEventId,
      sandboxProfileId: input.sandboxProfileId,
      integrationFamilyId: input.integrationFamilyId,
      runtimeId: input.runtimeContext.runtimeId,
      conversationKey,
      status: TriggerConversationStatuses.ACTIVE,
      updatedAt: sql`now()`,
      lastActivityAt: sql`now()`,
    })
    .onConflictDoNothing({
      target: [
        tables.triggerConversations.organizationId,
        tables.triggerConversations.ownerKind,
        tables.triggerConversations.ownerId,
        tables.triggerConversations.conversationKey,
      ],
    })
    .returning({
      id: tables.triggerConversations.id,
    });
  const insertedRow = insertedRows[0];
  if (insertedRow !== undefined) {
    return insertedRow.id;
  }

  const existingConversation = await db.query.triggerConversations.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.ownerKind, TriggerConversationOwnerKinds.PROVIDER_RESOURCE_ASSOCIATION),
        eq(table.ownerId, input.providerResourceAssociationId),
        eq(table.conversationKey, conversationKey),
      ),
  });
  if (existingConversation === undefined) {
    throw new Error(
      "Expected provider resource association trigger conversation after insert conflict.",
    );
  }

  return existingConversation.id;
}

function createProviderResourceAssociationConversationKey(input: {
  providerResourceAssociationId: string;
}): string {
  return `provider-resource-association:${input.providerResourceAssociationId}:original-runtime`;
}

async function discoverOriginalCodexProviderConversationId(input: {
  connectionUrl: string;
}): Promise<string> {
  const adapter = getConversationProviderAdapter("codex");
  const connection = await adapter.connect({
    connectionUrl: input.connectionUrl,
  });

  try {
    const originalThreadId = resolveOriginalCodexThreadId([
      ...(await listOriginalCodexThreadCandidates({ connection })),
      ...(await listOriginalCodexThreadCandidates({ connection, archived: true })),
    ]);
    if (originalThreadId === null) {
      throw new ProviderResourceAssociationDeliveryError({
        code: ProviderResourceAssociationDeliveryFailureCodes.ROUTING_CONVERSATION_NOT_FOUND,
        message: "Associated sandbox Codex runtime does not have an original non-subagent thread.",
      });
    }

    return originalThreadId;
  } finally {
    await connection.close();
  }
}

async function listOriginalCodexThreadCandidates(input: {
  connection: ProviderConnection;
  archived?: boolean;
}): Promise<readonly CodexThreadSummary[]> {
  let cursor: string | null = null;
  const threads: CodexThreadSummary[] = [];

  do {
    const response = await input.connection.request({
      method: "thread/list",
      params: {
        cursor,
        limit: OriginalCodexThreadListPageSize,
        ...(input.archived === undefined ? {} : { archived: input.archived }),
        sortKey: "created_at",
        sourceKinds: AllCodexThreadSourceKinds,
      },
    });
    const parsedResponse = parseCodexThreadListResponse(response);
    threads.push(...parsedResponse.threads);
    cursor = parsedResponse.nextCursor;
  } while (cursor !== null);

  return threads;
}

async function ensureProviderResourceAssociationConversationRoute(
  db: ControlPlaneDatabase,
  input: {
    conversationId: string;
    providerConversationId: string;
    sandboxInstanceId: string;
  },
): Promise<{
  routeId: string;
  providerExecutionId: string | null;
}> {
  const tables = getControlPlaneDatabaseSchema(db);
  const insertedRows = await db
    .insert(tables.triggerConversationRoutes)
    .values({
      conversationId: input.conversationId,
      sandboxInstanceId: input.sandboxInstanceId,
      providerConversationId: input.providerConversationId,
      providerExecutionId: null,
      providerState: null,
      status: TriggerConversationRouteStatuses.ACTIVE,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [tables.triggerConversationRoutes.conversationId],
      set: {
        sandboxInstanceId: input.sandboxInstanceId,
        providerConversationId: input.providerConversationId,
        status: TriggerConversationRouteStatuses.ACTIVE,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      routeId: tables.triggerConversationRoutes.id,
      providerExecutionId: tables.triggerConversationRoutes.providerExecutionId,
    });
  const insertedRow = insertedRows[0];
  if (insertedRow === undefined) {
    throw new Error("Expected provider resource association route to be inserted or updated.");
  }

  return insertedRow;
}
