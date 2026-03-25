import { randomUUID } from "node:crypto";

import {
  SandboxInstanceStatuses,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { StartSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { typeid } from "typeid-js";
import { z } from "zod";

import { DataPlaneOpenWorkflowSchema } from "../../../openworkflow/index.js";
import type { AppRuntimeResources } from "../../../resources.js";
import type { DataPlaneApiConfig, DataPlaneApiGlobalConfig } from "../../../types.js";
import type {
  StartSandboxInstanceAcceptedResponse,
  StartSandboxInstanceInput,
} from "../start-sandbox-instance/schema.js";

const WorkflowRunInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
  })
  .loose();

type StartSandboxInstanceContext = {
  db: DataPlaneDatabase;
  openWorkflow: AppRuntimeResources["openWorkflow"];
  workflowDbPool: AppRuntimeResources["workflowDbPool"];
  workflowNamespaceId: DataPlaneApiConfig["workflow"]["namespaceId"];
  sandboxProvider: DataPlaneApiGlobalConfig["sandbox"]["provider"];
};

function createStartSandboxIdempotencyKey(input: StartSandboxInstanceInput): string {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  return JSON.stringify({
    version: 1,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    source: input.source,
    idempotencyKey,
  });
}

function createSandboxInstanceId(): string {
  return typeid("sbi").toString();
}

async function resolveWorkflowSandboxInstanceId(input: {
  workflowDbPool: AppRuntimeResources["workflowDbPool"];
  workflowNamespaceId: string;
  workflowRunId: string;
}): Promise<string> {
  const result = await input.workflowDbPool.query(
    `
      select input
      from ${DataPlaneOpenWorkflowSchema}.workflow_runs
      where namespace_id = $1 and id = $2
      limit 1
    `,
    [input.workflowNamespaceId, input.workflowRunId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(
      `Workflow run '${input.workflowRunId}' was not found in the workflow database.`,
    );
  }

  const parsedInput = WorkflowRunInputSchema.safeParse(row.input);
  if (!parsedInput.success) {
    throw new Error(`Workflow run '${input.workflowRunId}' has invalid stored input.`);
  }

  return parsedInput.data.sandboxInstanceId;
}

export async function startSandboxInstance(
  ctx: StartSandboxInstanceContext,
  input: StartSandboxInstanceInput,
): Promise<StartSandboxInstanceAcceptedResponse> {
  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    StartSandboxInstanceWorkflowSpec,
    {
      ...input,
      sandboxInstanceId: createSandboxInstanceId(),
    },
    {
      idempotencyKey: createStartSandboxIdempotencyKey(input),
    },
  );

  const sandboxInstanceId = await resolveWorkflowSandboxInstanceId({
    workflowDbPool: ctx.workflowDbPool,
    workflowNamespaceId: ctx.workflowNamespaceId,
    workflowRunId: workflowRunHandle.workflowRun.id,
  });

  await ctx.db
    .insert(sandboxInstances)
    .values({
      id: sandboxInstanceId,
      organizationId: input.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      sandboxProfileVersion: input.sandboxProfileVersion,
      runtimeProvider: ctx.sandboxProvider,
      providerSandboxId: null,
      status: SandboxInstanceStatuses.STARTING,
      startedByKind: input.startedBy.kind,
      startedById: input.startedBy.id,
      source: input.source,
    })
    .onConflictDoNothing({
      target: [sandboxInstances.id],
    });

  return {
    status: "accepted",
    sandboxInstanceId,
    workflowRunId: workflowRunHandle.workflowRun.id,
  };
}
