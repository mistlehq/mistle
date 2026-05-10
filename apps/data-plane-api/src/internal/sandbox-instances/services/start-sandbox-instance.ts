import { randomUUID } from "node:crypto";

import {
  SandboxInstancePersistenceModes,
  type SandboxInstancePersistenceMode,
  SandboxInstancePurposes,
  type SandboxInstancePurpose,
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { SandboxProvider } from "@mistle/sandbox";
import {
  type SandboxRuntimeProviderInput,
  StartSandboxInstanceWorkflowSpec,
} from "@mistle/workflow-registry/data-plane";
import { typeid } from "typeid-js";
import { z } from "zod";

import { DataPlaneOpenWorkflowSchema } from "../../../openworkflow/index.js";
import type { AppRuntimeResources } from "../../../resources.js";
import type { DataPlaneApiConfig, DataPlaneApiSandboxStorageBackend } from "../../../types.js";
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
  tables: Pick<DataPlaneTables, "sandboxInstances">;
  openWorkflow: AppRuntimeResources["openWorkflow"];
  workflowDbPool: AppRuntimeResources["workflowDbPool"];
  workflowNamespaceId: DataPlaneApiConfig["workflow"]["namespaceId"];
  sandboxStorageBackend: DataPlaneApiSandboxStorageBackend;
};

function createStartSandboxIdempotencyKey(input: StartSandboxInstanceInput): string {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  return JSON.stringify({
    version: 1,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    purpose: input.purpose,
    source: input.source,
    idempotencyKey,
  });
}

function createSandboxInstanceId(): string {
  return typeid("sbi").toString();
}

function createWorkflowSandboxRuntime(
  input: StartSandboxInstanceInput["sandboxRuntime"],
): SandboxRuntimeProviderInput {
  const resources =
    input.resources === undefined
      ? undefined
      : {
          vcpuCount: input.resources.vcpuCount,
          memoryMb: input.resources.memoryMb,
          ...(input.resources.storageMb === undefined
            ? {}
            : { storageMb: input.resources.storageMb }),
        };

  return {
    provider: input.provider,
    ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
    ...(resources === undefined ? {} : { resources }),
  };
}

export function resolveSandboxInstancePersistenceMode(input: {
  organizationId: string;
  purpose: SandboxInstancePurpose;
  effectivePersistenceMode: SandboxInstancePersistenceMode;
  sandboxProvider: SandboxProvider;
  configuredStorageBackend: DataPlaneApiSandboxStorageBackend;
}): SandboxInstancePersistenceMode {
  if (input.purpose === SandboxInstancePurposes.SETUP_CHECK) {
    return SandboxInstancePersistenceModes.EPHEMERAL;
  }

  if (input.effectivePersistenceMode === SandboxInstancePersistenceModes.EPHEMERAL) {
    return SandboxInstancePersistenceModes.EPHEMERAL;
  }

  if (
    input.sandboxProvider === SandboxProvider.E2B &&
    input.configuredStorageBackend === "archil"
  ) {
    return SandboxInstancePersistenceModes.PERSISTENT;
  }

  if (
    input.sandboxProvider === SandboxProvider.DOCKER &&
    input.configuredStorageBackend === "docker_volume"
  ) {
    return SandboxInstancePersistenceModes.PERSISTENT;
  }

  throw new BadRequestError(
    "INVALID_SANDBOX_STORAGE_CONFIGURATION",
    `Persistent sandbox was requested for organization '${input.organizationId}' but no supported durable storage backend is configured for this deployment.`,
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
  const { sandboxInstances } = ctx.tables;
  const sandboxRuntime = createWorkflowSandboxRuntime(input.sandboxRuntime);
  if (input.image.provider !== input.sandboxRuntime.provider) {
    throw new BadRequestError(
      "INVALID_SANDBOX_RUNTIME_PROVIDER",
      `Sandbox launch image provider '${input.image.provider}' does not match sandbox runtime provider '${input.sandboxRuntime.provider}'.`,
    );
  }

  const persistenceMode = resolveSandboxInstancePersistenceMode({
    organizationId: input.organizationId,
    purpose: input.purpose,
    effectivePersistenceMode: input.persistenceMode,
    sandboxProvider: sandboxRuntime.provider,
    configuredStorageBackend: ctx.sandboxStorageBackend,
  });

  const workflowInput = {
    sandboxInstanceId: createSandboxInstanceId(),
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    persistenceMode,
    purpose: input.purpose,
    runtimePlan: input.runtimePlan,
    startedBy: input.startedBy,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
    source: input.source,
    image: input.image,
    sandboxRuntime,
    ...(input.gitIdentity === undefined ? {} : { gitIdentity: input.gitIdentity }),
  };

  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    StartSandboxInstanceWorkflowSpec,
    workflowInput,
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
      runtimeProvider: sandboxRuntime.provider,
      sandboxConnectionId: sandboxRuntime.connectionId ?? null,
      sandboxVcpuCount: sandboxRuntime.resources?.vcpuCount ?? null,
      sandboxMemoryMb: sandboxRuntime.resources?.memoryMb ?? null,
      sandboxStorageMb: sandboxRuntime.resources?.storageMb ?? null,
      providerSandboxId: null,
      computeGeneration: 1,
      status: SandboxInstanceStatuses.PENDING,
      startedByKind: input.startedBy.kind,
      startedById: input.startedBy.id,
      source: input.source,
      purpose: input.purpose,
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
