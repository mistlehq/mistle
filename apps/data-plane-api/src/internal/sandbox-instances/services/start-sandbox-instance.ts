import { randomUUID } from "node:crypto";

import {
  SandboxInstancePersistenceModes,
  type SandboxInstancePersistenceMode,
  SandboxInstanceStatuses,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { SandboxProvider } from "@mistle/sandbox";
import { StartSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { typeid } from "typeid-js";
import { z } from "zod";

import { DataPlaneOpenWorkflowSchema } from "../../../openworkflow/index.js";
import type { AppRuntimeResources } from "../../../resources.js";
import type {
  DataPlaneApiConfig,
  DataPlaneApiGlobalConfig,
  DataPlaneApiSandboxStorageBackend,
} from "../../../types.js";
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
  controlPlaneInternalClient: AppRuntimeResources["controlPlaneInternalClient"];
  workflowNamespaceId: DataPlaneApiConfig["workflow"]["namespaceId"];
  sandboxProvider: DataPlaneApiGlobalConfig["sandbox"]["provider"];
  sandboxStorageBackend: DataPlaneApiSandboxStorageBackend;
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

export function resolveSandboxInstancePersistenceMode(input: {
  organizationId: string;
  persistentSandboxesEnabled: boolean;
  sandboxProvider: DataPlaneApiGlobalConfig["sandbox"]["provider"];
  configuredStorageBackend: DataPlaneApiSandboxStorageBackend;
}): SandboxInstancePersistenceMode {
  if (!input.persistentSandboxesEnabled) {
    return SandboxInstancePersistenceModes.EPHEMERAL;
  }

  if (
    input.sandboxProvider === SandboxProvider.E2B &&
    input.configuredStorageBackend === "archil"
  ) {
    return SandboxInstancePersistenceModes.PERSISTENT;
  }

  throw new Error(
    `Persistent sandboxes are enabled for organization '${input.organizationId}' but no supported durable storage backend is configured for this deployment.`,
  );
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
  const storagePersistenceMode = await ctx.controlPlaneInternalClient.resolveStoragePersistenceMode(
    {
      organizationId: input.organizationId,
    },
  );
  const persistenceMode = resolveSandboxInstancePersistenceMode({
    organizationId: input.organizationId,
    persistentSandboxesEnabled: storagePersistenceMode.persistentSandboxesEnabled,
    sandboxProvider: ctx.sandboxProvider,
    configuredStorageBackend: ctx.sandboxStorageBackend,
  });

  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    StartSandboxInstanceWorkflowSpec,
    {
      ...input,
      sandboxInstanceId: createSandboxInstanceId(),
      persistenceMode,
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
      status: SandboxInstanceStatuses.PENDING,
      startedByKind: input.startedBy.kind,
      startedById: input.startedBy.id,
      source: input.source,
      persistenceMode,
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
