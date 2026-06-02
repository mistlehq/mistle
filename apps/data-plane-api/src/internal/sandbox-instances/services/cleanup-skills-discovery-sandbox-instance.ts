import {
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
  SandboxStopReasons,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstanceStatus,
} from "@mistle/db/data-plane";
import { ConflictError, NotFoundError } from "@mistle/http/errors.js";
import { isSandboxUserStopEligible } from "@mistle/sandbox-lifecycle";
import { StopSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { AppRuntimeResources } from "../../../resources.js";
import type { CleanupSkillsDiscoverySandboxInstanceResponse } from "../cleanup-skills-discovery-sandbox-instance/schema.js";

type CleanupSkillsDiscoverySandboxInstanceContext = {
  db: DataPlaneDatabase;
  openWorkflow: Pick<AppRuntimeResources["openWorkflow"], "cancelWorkflowRun" | "runWorkflow">;
  tables: Pick<DataPlaneTables, "sandboxInstances">;
};

type CleanupSkillsDiscoverySandboxInstanceInput = {
  organizationId: string;
  sandboxInstanceId: string;
  startWorkflowRunId: string;
  idempotencyKey: string;
};

const SkillsDiscoverySandboxInstanceNotFoundErrorCode = "NOT_FOUND";
const SkillsDiscoverySandboxInstanceCleanupConflictErrorCode = "SKILLS_DISCOVERY_CLEANUP_CONFLICT";

function createSkillsDiscoveryStopIdempotencyKey(
  input: CleanupSkillsDiscoverySandboxInstanceInput,
): string {
  return JSON.stringify({
    version: 1,
    sandboxInstanceId: input.sandboxInstanceId,
    action: "skills_discovery_cleanup_stop",
    organizationId: input.organizationId,
    idempotencyKey: input.idempotencyKey,
  });
}

function isPreProviderStartupStatus(status: SandboxInstanceStatus): boolean {
  return status === SandboxInstanceStatuses.PENDING || status === SandboxInstanceStatuses.STARTING;
}

function isProviderBackedStartupStatus(status: SandboxInstanceStatus): boolean {
  return (
    status === SandboxInstanceStatuses.STARTING ||
    status === SandboxInstanceStatuses.STARTED ||
    status === SandboxInstanceStatuses.INITIALIZING
  );
}

export async function cleanupSkillsDiscoverySandboxInstance(
  ctx: CleanupSkillsDiscoverySandboxInstanceContext,
  input: CleanupSkillsDiscoverySandboxInstanceInput,
): Promise<CleanupSkillsDiscoverySandboxInstanceResponse> {
  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      providerSandboxId: true,
      status: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.sandboxInstanceId),
        whereEq(table.organizationId, input.organizationId),
        whereEq(table.purpose, SandboxInstancePurposes.SKILLS_DISCOVERY),
      ),
  });

  if (sandboxInstance === undefined) {
    throw new NotFoundError(
      SkillsDiscoverySandboxInstanceNotFoundErrorCode,
      `Skills discovery sandbox instance '${input.sandboxInstanceId}' was not found.`,
    );
  }

  if (sandboxInstance.status === SandboxInstanceStatuses.STOPPED) {
    return {
      status: "already_stopped",
      sandboxInstanceId: input.sandboxInstanceId,
      workflowRunId: null,
    };
  }

  if (sandboxInstance.status === SandboxInstanceStatuses.FAILED) {
    return {
      status: "already_terminal",
      sandboxInstanceId: input.sandboxInstanceId,
      workflowRunId: null,
    };
  }

  if (
    sandboxInstance.providerSandboxId !== null ||
    isSandboxUserStopEligible(sandboxInstance.status)
  ) {
    if (isProviderBackedStartupStatus(sandboxInstance.status)) {
      await ctx.openWorkflow.cancelWorkflowRun(input.startWorkflowRunId);
    }

    const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
      StopSandboxInstanceWorkflowSpec,
      {
        sandboxInstanceId: input.sandboxInstanceId,
        stopReason: "user",
      },
      {
        idempotencyKey: createSkillsDiscoveryStopIdempotencyKey(input),
      },
    );

    return {
      status: "accepted",
      sandboxInstanceId: input.sandboxInstanceId,
      workflowRunId: workflowRunHandle.workflowRun.id,
    };
  }

  if (!isPreProviderStartupStatus(sandboxInstance.status)) {
    throw new ConflictError(
      SkillsDiscoverySandboxInstanceCleanupConflictErrorCode,
      `Skills discovery sandbox instance '${input.sandboxInstanceId}' is '${sandboxInstance.status}' without provider sandbox metadata and cannot be cleaned up.`,
    );
  }

  await ctx.openWorkflow.cancelWorkflowRun(input.startWorkflowRunId);

  const stoppedRows = await ctx.db
    .update(ctx.tables.sandboxInstances)
    .set({
      status: SandboxInstanceStatuses.STOPPED,
      stoppedAt: sql`now()`,
      stopReason: SandboxStopReasons.SYSTEM,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(ctx.tables.sandboxInstances.id, input.sandboxInstanceId),
        eq(ctx.tables.sandboxInstances.organizationId, input.organizationId),
        eq(ctx.tables.sandboxInstances.purpose, SandboxInstancePurposes.SKILLS_DISCOVERY),
        inArray(ctx.tables.sandboxInstances.status, [
          SandboxInstanceStatuses.PENDING,
          SandboxInstanceStatuses.STARTING,
        ]),
        isNull(ctx.tables.sandboxInstances.providerSandboxId),
      ),
    )
    .returning({
      id: ctx.tables.sandboxInstances.id,
    });

  if (stoppedRows[0] === undefined) {
    throw new ConflictError(
      SkillsDiscoverySandboxInstanceCleanupConflictErrorCode,
      `Skills discovery sandbox instance '${input.sandboxInstanceId}' changed while cleanup was canceling startup.`,
    );
  }

  return {
    status: "stopped_before_provider_start",
    sandboxInstanceId: input.sandboxInstanceId,
    workflowRunId: null,
  };
}
