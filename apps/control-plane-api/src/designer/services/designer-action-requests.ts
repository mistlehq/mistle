import {
  DesignerActionRequestOperationKinds,
  DesignerActionRequestResponses,
  DesignerActionRequestStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
  type DesignerActionRequest,
  type DesignerActionRequestOperation,
  type DesignerActionRequestOperationResult,
  type DesignerActionRequestResponse,
  type DesignerActionRequestStatus,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import { DesignerConflictCodes } from "../constants.js";
import { DesignerConflictError } from "../errors.js";
import type { DesignerActionProposal } from "../schemas.js";

type ControlPlaneTransaction = Parameters<Parameters<ControlPlaneDatabase["transaction"]>[0]>[0];
type DesignerActionRequestDatabase = ControlPlaneDatabase | ControlPlaneTransaction;

type ClaimedDesignerActionRequest = {
  actionRequest: DesignerActionRequest;
  created: boolean;
};

export function toDesignerActionRequestOperation(
  operation: DesignerActionProposal["operation"],
): DesignerActionRequestOperation {
  switch (operation.kind) {
    case DesignerActionRequestOperationKinds.PROVIDER_CONFIGURATION_CHANGE:
      return {
        kind: operation.kind,
        provider: operation.provider,
        resourceType: operation.resourceType,
        resourceLabel: operation.resourceLabel,
        action: operation.action,
        details: operation.details.map((detail) => ({
          label: detail.label,
          value: detail.value,
        })),
      };
    case DesignerActionRequestOperationKinds.SANDBOX_PROFILE_DRAFT_PUBLISH:
      return {
        kind: operation.kind,
        profileId: operation.profileId,
        version: operation.version,
      };
    case DesignerActionRequestOperationKinds.SANDBOX_PROFILE_DRAFT_SETUP_SCRIPT_PUT:
      return {
        kind: operation.kind,
        profileId: operation.profileId,
        version: operation.version,
        setupScript: operation.setupScript,
      };
    case DesignerActionRequestOperationKinds.SANDBOX_PROFILE_VERSION_LAUNCH:
      return {
        kind: operation.kind,
        profileId: operation.profileId,
        version: operation.version,
        ...(operation.primaryRepositoryId === undefined
          ? {}
          : { primaryRepositoryId: operation.primaryRepositoryId }),
        idempotencyKey: operation.idempotencyKey,
      };
  }
}

export async function claimDesignerActionRequest(
  ctx: { db: DesignerActionRequestDatabase },
  input: {
    organizationId: string;
    sessionId: string;
    proposalId: string;
    response: DesignerActionRequestResponse;
    responseIdempotencyKey: string;
    requestedByUserId: string;
    runtimeProviderConversationId: string;
    operation: DesignerActionRequestOperation;
  },
): Promise<ClaimedDesignerActionRequest> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const status =
    input.response === DesignerActionRequestResponses.DECLINED
      ? DesignerActionRequestStatuses.DECLINED
      : DesignerActionRequestStatuses.APPROVED;
  const insertedRows = await ctx.db
    .insert(tables.designerActionRequests)
    .values({
      organizationId: input.organizationId,
      designerSessionId: input.sessionId,
      proposalId: input.proposalId,
      response: input.response,
      responseIdempotencyKey: input.responseIdempotencyKey,
      requestedByUserId: input.requestedByUserId,
      runtimeProviderConversationId: input.runtimeProviderConversationId,
      operationKind: input.operation.kind,
      operation: input.operation,
      status,
    })
    .onConflictDoNothing({
      target: [
        tables.designerActionRequests.designerSessionId,
        tables.designerActionRequests.proposalId,
      ],
    })
    .returning();

  const inserted = insertedRows[0];
  if (inserted !== undefined) {
    return {
      actionRequest: inserted,
      created: true,
    };
  }

  const existing = await ctx.db.query.designerActionRequests.findFirst({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.organizationId, input.organizationId),
        whereEq(table.designerSessionId, input.sessionId),
        whereEq(table.proposalId, input.proposalId),
      ),
  });

  if (existing === undefined) {
    throw new Error(
      `Expected existing Designer action request for proposal '${input.proposalId}' after insert conflict.`,
    );
  }

  if (
    existing.response === input.response &&
    existing.responseIdempotencyKey === input.responseIdempotencyKey
  ) {
    return {
      actionRequest: existing,
      created: false,
    };
  }

  throw new DesignerConflictError(
    DesignerConflictCodes.DESIGNER_ACTION_PROPOSAL_NOT_PENDING,
    `Designer action proposal '${input.proposalId}' is not pending.`,
  );
}

export async function readDesignerActionRequestForResponse(
  ctx: { db: DesignerActionRequestDatabase },
  input: {
    organizationId: string;
    sessionId: string;
    proposalId: string;
    response: DesignerActionRequestResponse;
    responseIdempotencyKey: string;
  },
): Promise<DesignerActionRequest | null> {
  const existing = await ctx.db.query.designerActionRequests.findFirst({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.organizationId, input.organizationId),
        whereEq(table.designerSessionId, input.sessionId),
        whereEq(table.proposalId, input.proposalId),
      ),
  });

  if (existing === undefined) {
    return null;
  }

  if (
    existing.response === input.response &&
    existing.responseIdempotencyKey === input.responseIdempotencyKey
  ) {
    return existing;
  }

  throw new DesignerConflictError(
    DesignerConflictCodes.DESIGNER_ACTION_PROPOSAL_NOT_PENDING,
    `Designer action proposal '${input.proposalId}' is not pending.`,
  );
}

export async function updateDesignerActionRequestExecutionStatus(
  ctx: { db: DesignerActionRequestDatabase },
  input: {
    organizationId: string;
    actionRequestId: string;
    status: DesignerActionRequestStatus;
    failureCode: string | null;
    failureMessage: string | null;
    operationResult: DesignerActionRequestOperationResult | null;
  },
): Promise<DesignerActionRequest> {
  if (input.status === DesignerActionRequestStatuses.COMPLETED && input.operationResult === null) {
    throw new Error("Completed Designer action request execution requires an operation result.");
  }
  if (input.status !== DesignerActionRequestStatuses.COMPLETED && input.operationResult !== null) {
    throw new Error("Only completed Designer action request execution can store operation result.");
  }

  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedRows = await ctx.db
    .update(tables.designerActionRequests)
    .set({
      status: input.status,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      operationResult: input.operationResult,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.designerActionRequests.id, input.actionRequestId),
        eq(tables.designerActionRequests.organizationId, input.organizationId),
      ),
    )
    .returning();

  const updated = updatedRows[0];
  if (updated === undefined) {
    throw new Error(`Designer action request '${input.actionRequestId}' was not found.`);
  }

  return updated;
}

export async function claimDesignerActionRequestExecution(
  ctx: { db: DesignerActionRequestDatabase },
  input: {
    organizationId: string;
    actionRequestId: string;
  },
): Promise<DesignerActionRequest> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedRows = await ctx.db
    .update(tables.designerActionRequests)
    .set({
      status: DesignerActionRequestStatuses.EXECUTING,
      failureCode: null,
      failureMessage: null,
      operationResult: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.designerActionRequests.id, input.actionRequestId),
        eq(tables.designerActionRequests.organizationId, input.organizationId),
        eq(tables.designerActionRequests.status, DesignerActionRequestStatuses.APPROVED),
      ),
    )
    .returning();

  const updated = updatedRows[0];
  if (updated !== undefined) {
    return updated;
  }

  const existing = await ctx.db.query.designerActionRequests.findFirst({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.actionRequestId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (existing === undefined) {
    throw new Error(`Designer action request '${input.actionRequestId}' was not found.`);
  }

  return existing;
}

export async function markDesignerActionRequestResponseSubmitted(
  ctx: { db: DesignerActionRequestDatabase },
  input: {
    organizationId: string;
    actionRequestId: string;
    runtimeProviderExecutionId: string | null;
    responseSubmittedAt: string;
  },
): Promise<DesignerActionRequest> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const updatedRows = await ctx.db
    .update(tables.designerActionRequests)
    .set({
      runtimeProviderExecutionId: input.runtimeProviderExecutionId,
      responseSubmittedAt: input.responseSubmittedAt,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.designerActionRequests.id, input.actionRequestId),
        eq(tables.designerActionRequests.organizationId, input.organizationId),
      ),
    )
    .returning();

  const updated = updatedRows[0];
  if (updated === undefined) {
    throw new Error(`Designer action request '${input.actionRequestId}' was not found.`);
  }

  return updated;
}
