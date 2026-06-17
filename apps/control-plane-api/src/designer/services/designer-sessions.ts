import { randomUUID } from "node:crypto";

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
  SandboxImageSources,
  createDisabledAssociatedResourceEventRouting,
} from "@mistle/integrations-core";
import { SandboxProvider } from "@mistle/sandbox";
import { and, desc, eq, sql } from "drizzle-orm";

import type { ControlPlaneApiSandboxRuntimeConfig } from "../../types.js";
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
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
};

function resolveDesignerSandboxRuntime(sandboxConfig: ControlPlaneApiSandboxRuntimeConfig) {
  if (sandboxConfig.docker?.enabled !== true) {
    throw new DesignerBadRequestError(
      DesignerBadRequestCodes.DESIGNER_SANDBOX_RUNTIME_UNAVAILABLE,
      "Designer sessions require the Docker sandbox runtime in this first implementation.",
    );
  }

  return {
    provider: SandboxProvider.DOCKER,
  };
}

function createDesignerRuntimePlan(input: { imageRef: string }) {
  return CompiledRuntimePlanSchema.parse({
    sandboxProfileId: DESIGNER_RUNTIME_PROFILE_ID,
    version: DESIGNER_RUNTIME_PROFILE_VERSION,
    image: {
      source: SandboxImageSources.BASE,
      imageRef: input.imageRef,
    },
    associatedResourceEventRouting: createDisabledAssociatedResourceEventRouting(),
    egressRoutes: [],
    artifacts: [],
    workspaceSources: [],
    runtimeClients: [],
    agentRuntimes: [],
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
  const sandboxRuntime = resolveDesignerSandboxRuntime(ctx.sandboxConfig);
  const runtimePlan = createDesignerRuntimePlan({
    imageRef: ctx.sandboxConfig.defaultBaseImage,
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
      imageId: ctx.sandboxConfig.defaultBaseImage,
      createdAt: new Date().toISOString(),
      kind: "base",
      provider: SandboxProvider.DOCKER,
    },
    sandboxRuntime,
  });

  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const createdDesignerSessionRows = await ctx.db
    .insert(tables.designerSessions)
    .values({
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
