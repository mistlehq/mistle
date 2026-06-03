import {
  SandboxInstanceDeadlineKinds,
  SandboxInstancePurposes,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstancePurpose,
  type SandboxInstanceStatus,
} from "@mistle/db/data-plane";
import { ConflictError, NotFoundError } from "@mistle/http/errors.js";
import {
  SandboxInstanceStatuses,
  SandboxLifecycleEvents,
  isSandboxUserStopEligible,
  transitionSandboxLifecycle,
} from "@mistle/sandbox-lifecycle";
import { StopSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { and, eq, isNull, sql } from "drizzle-orm";

import { logger } from "../../../logger.js";
import type { AppRuntimeResources } from "../../../resources.js";
import type {
  StopSandboxInstanceInput,
  StopSandboxInstanceResponse,
} from "../stop-sandbox-instance/schema.js";

type StopSandboxInstanceContext = {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstanceDeadlines" | "sandboxInstances">;
  openWorkflow: AppRuntimeResources["openWorkflow"];
};

const SandboxInstanceNotFoundErrorCode = "NOT_FOUND";
const SandboxInstanceUserStopNotSupportedErrorCode = "USER_STOP_NOT_SUPPORTED";
const SandboxInstanceStaleStopRequestErrorCode = "STALE_STOP_REQUEST";

type StopRequestClaimResult =
  | {
      kind: "enqueue";
    }
  | {
      kind: "terminal_response";
      response: StopSandboxInstanceResponse;
    };
type StopRequestClaimAttemptResult = StopRequestClaimResult | null;

function createStopSandboxIdempotencyKey(input: StopSandboxInstanceInput): string {
  if (input.stopReason === "user") {
    return JSON.stringify({
      version: 1,
      sandboxInstanceId: input.sandboxInstanceId,
      action: "user_stop",
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  return JSON.stringify({
    version: 1,
    sandboxInstanceId: input.sandboxInstanceId,
    action: "stop",
    stopReason: input.stopReason,
    expectedOwnerLeaseId: input.expectedOwnerLeaseId,
    idempotencyKey: input.idempotencyKey,
  });
}

function supportsUserRequestedStop(purpose: SandboxInstancePurpose): boolean {
  return (
    purpose === SandboxInstancePurposes.SESSION ||
    purpose === SandboxInstancePurposes.SETUP_ASSISTANT ||
    purpose === SandboxInstancePurposes.SETUP_CHECK ||
    purpose === SandboxInstancePurposes.SKILLS_DISCOVERY
  );
}

export async function stopSandboxInstance(
  ctx: StopSandboxInstanceContext,
  input: StopSandboxInstanceInput,
): Promise<StopSandboxInstanceResponse> {
  const claimResult = await claimSandboxInstanceStop(ctx, input);
  if (claimResult.kind === "terminal_response") {
    return claimResult.response;
  }

  let workflowRunHandle: Awaited<ReturnType<typeof ctx.openWorkflow.runWorkflow>>;
  try {
    workflowRunHandle = await ctx.openWorkflow.runWorkflow(
      StopSandboxInstanceWorkflowSpec,
      input.stopReason === "idle"
        ? {
            sandboxInstanceId: input.sandboxInstanceId,
            stopReason: input.stopReason,
            expectedOwnerLeaseId: input.expectedOwnerLeaseId,
          }
        : {
            sandboxInstanceId: input.sandboxInstanceId,
            stopReason: input.stopReason,
          },
      {
        idempotencyKey: createStopSandboxIdempotencyKey(input),
      },
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        sandboxInstanceId: input.sandboxInstanceId,
        stopReason: input.stopReason,
      },
      "Failed to enqueue sandbox stop workflow after marking sandbox instance stopping.",
    );
    throw error;
  }

  return {
    status: "accepted",
    sandboxInstanceId: input.sandboxInstanceId,
    workflowRunId: workflowRunHandle.workflowRun.id,
  };
}

async function claimSandboxInstanceStop(
  ctx: StopSandboxInstanceContext,
  input: StopSandboxInstanceInput,
): Promise<StopRequestClaimResult> {
  return ctx.db.transaction(async (tx) => {
    const sandboxInstance = await tx.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        purpose: true,
        status: true,
      },
      where: (table, { and: whereAnd, eq: whereEq, isNull: whereIsNull }) =>
        whereAnd(
          whereEq(table.id, input.sandboxInstanceId),
          whereIsNull(table.deletedAt),
          ...(input.stopReason === "user"
            ? [whereEq(table.organizationId, input.organizationId)]
            : []),
        ),
    });

    if (sandboxInstance === undefined) {
      throw new NotFoundError(
        SandboxInstanceNotFoundErrorCode,
        `Sandbox instance '${input.sandboxInstanceId}' was not found.`,
      );
    }

    if (input.stopReason === "user" && !supportsUserRequestedStop(sandboxInstance.purpose)) {
      throw new ConflictError(
        SandboxInstanceUserStopNotSupportedErrorCode,
        `User-requested stop is only supported for session, setup-check, setup-assistant, and skills-discovery sandbox instances; sandbox instance '${input.sandboxInstanceId}' has purpose '${sandboxInstance.purpose}'.`,
      );
    }

    if (sandboxInstance.status === SandboxInstanceStatuses.STOPPED) {
      return {
        kind: "terminal_response",
        response: {
          status: "already_stopped",
          sandboxInstanceId: input.sandboxInstanceId,
          workflowRunId: null,
        },
      };
    }

    if (sandboxInstance.status === SandboxInstanceStatuses.FAILED) {
      return {
        kind: "terminal_response",
        response: {
          status: "already_terminal",
          sandboxInstanceId: input.sandboxInstanceId,
          workflowRunId: null,
        },
      };
    }

    if (
      input.stopReason === "user" &&
      !isSandboxUserStopEligible(sandboxInstance.status) &&
      sandboxInstance.status !== SandboxInstanceStatuses.STOPPING
    ) {
      throw new ConflictError(
        SandboxInstanceUserStopNotSupportedErrorCode,
        `Sandbox instance '${input.sandboxInstanceId}' is '${sandboxInstance.status}' and cannot be stopped yet.`,
      );
    }

    const claimAttempt = await claimStopRequestFromStatus(
      {
        db: tx,
        tables: ctx.tables,
      },
      {
        input,
        status: sandboxInstance.status,
      },
    );

    if (claimAttempt !== null) {
      return claimAttempt;
    }

    return resolveStopRequestAfterMissedStatusUpdate(
      {
        db: tx,
        tables: ctx.tables,
      },
      input,
    );
  });
}

async function claimStopRequestFromStatus(
  ctx: {
    db: Pick<DataPlaneDatabase, "select" | "update">;
    tables: Pick<DataPlaneTables, "sandboxInstanceDeadlines" | "sandboxInstances">;
  },
  request: {
    input: StopSandboxInstanceInput;
    status: SandboxInstanceStatus;
  },
): Promise<StopRequestClaimAttemptResult> {
  const transition = transitionSandboxLifecycle({
    status: request.status,
    event: SandboxLifecycleEvents.STOP_REQUESTED,
  });

  if (transition.kind === "invalid") {
    throw new ConflictError(SandboxInstanceUserStopNotSupportedErrorCode, transition.reason);
  }

  if (request.input.stopReason === "idle") {
    await assertIdleStopDeadlineStillCurrent(
      {
        db: ctx.db,
        tables: ctx.tables,
      },
      request.input,
    );
  }

  if (transition.kind === "unchanged") {
    return {
      kind: "enqueue",
    };
  }

  const { sandboxInstances } = ctx.tables;
  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      status: transition.to,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, request.input.sandboxInstanceId),
        eq(sandboxInstances.status, transition.from),
        isNull(sandboxInstances.deletedAt),
      ),
    )
    .returning({
      status: sandboxInstances.status,
    });

  if (updatedRows[0]?.status !== transition.to) {
    return null;
  }

  return {
    kind: "enqueue",
  };
}

async function assertIdleStopDeadlineStillCurrent(
  ctx: {
    db: Pick<DataPlaneDatabase, "select">;
    tables: Pick<DataPlaneTables, "sandboxInstanceDeadlines">;
  },
  input: Extract<StopSandboxInstanceInput, { stopReason: "idle" }>,
): Promise<void> {
  const { sandboxInstanceDeadlines } = ctx.tables;
  const rows = await ctx.db
    .select({
      ownerLeaseId: sandboxInstanceDeadlines.ownerLeaseId,
    })
    .from(sandboxInstanceDeadlines)
    .where(
      and(
        eq(sandboxInstanceDeadlines.sandboxInstanceId, input.sandboxInstanceId),
        eq(sandboxInstanceDeadlines.kind, SandboxInstanceDeadlineKinds.IDLE),
        eq(sandboxInstanceDeadlines.ownerLeaseId, input.expectedOwnerLeaseId),
        isNull(sandboxInstanceDeadlines.clearedAt),
      ),
    )
    .limit(1)
    .for("update");

  if (rows[0] === undefined) {
    throw new ConflictError(
      SandboxInstanceStaleStopRequestErrorCode,
      `Idle stop request for sandbox instance '${input.sandboxInstanceId}' is stale.`,
    );
  }
}

async function resolveStopRequestAfterMissedStatusUpdate(
  ctx: {
    db: Pick<DataPlaneDatabase, "query" | "select" | "update">;
    tables: Pick<DataPlaneTables, "sandboxInstanceDeadlines" | "sandboxInstances">;
  },
  input: StopSandboxInstanceInput,
): Promise<StopRequestClaimResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
      columns: {
        status: true,
      },
      where: (table, { and: whereAnd, eq: whereEq, isNull: whereIsNull }) =>
        whereAnd(whereEq(table.id, input.sandboxInstanceId), whereIsNull(table.deletedAt)),
    });
    if (sandboxInstance === undefined) {
      throw new NotFoundError(
        SandboxInstanceNotFoundErrorCode,
        `Sandbox instance '${input.sandboxInstanceId}' was not found.`,
      );
    }

    if (sandboxInstance.status === SandboxInstanceStatuses.STOPPED) {
      return {
        kind: "terminal_response",
        response: {
          status: "already_stopped",
          sandboxInstanceId: input.sandboxInstanceId,
          workflowRunId: null,
        },
      };
    }

    if (sandboxInstance.status === SandboxInstanceStatuses.FAILED) {
      return {
        kind: "terminal_response",
        response: {
          status: "already_terminal",
          sandboxInstanceId: input.sandboxInstanceId,
          workflowRunId: null,
        },
      };
    }

    const claimAttempt = await claimStopRequestFromStatus(ctx, {
      input,
      status: sandboxInstance.status,
    });

    if (claimAttempt !== null) {
      return claimAttempt;
    }
  }

  throw new Error(
    `Failed to transition sandbox instance '${input.sandboxInstanceId}' to stopping after concurrent status updates.`,
  );
}
