import { randomUUID } from "node:crypto";

import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import {
  type SandboxRuntimeProviderInput,
  StartSandboxInstanceWorkflowSpec,
} from "@mistle/workflow-registry/data-plane";
import { typeid } from "typeid-js";
import { z } from "zod";

import type { AppRuntimeResources } from "../../../resources.js";
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
          ...(input.resources.diskMb === undefined ? {} : { diskMb: input.resources.diskMb }),
        };

  return {
    provider: input.provider,
    ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
    ...(resources === undefined ? {} : { resources }),
  };
}

export function resolveWorkflowSandboxInstanceId(input: {
  workflowRunId: string;
  workflowRunInput: unknown;
}): string {
  const parsedInput = WorkflowRunInputSchema.safeParse(input.workflowRunInput);
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

  const workflowInput = {
    sandboxInstanceId: createSandboxInstanceId(),
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
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

  const sandboxInstanceId = resolveWorkflowSandboxInstanceId({
    workflowRunId: workflowRunHandle.workflowRun.id,
    workflowRunInput: workflowRunHandle.workflowRun.input,
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
      sandboxDiskMb: sandboxRuntime.resources?.diskMb ?? null,
      providerSandboxId: null,
      computeGeneration: 1,
      status: SandboxInstanceStatuses.PENDING,
      startedByKind: input.startedBy.kind,
      startedById: input.startedBy.id,
      source: input.source,
      purpose: input.purpose,
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
