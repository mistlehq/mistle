/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  createDataPlaneSandboxInstancesClient,
  type DataPlaneSandboxInstancesClient,
  type ResumeSandboxInstanceInput,
  type StartSandboxInstanceInput,
} from "@mistle/data-plane-internal-client";
import { SandboxInstancePurposes, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { createDataPlaneWorkflowNamespaceId } from "@mistle/db/test-environment";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemClock, systemSleeper } from "@mistle/time";
import {
  ResumeSandboxInstanceWorkflowName,
  StartSandboxInstanceWorkflowName,
} from "@mistle/workflow-registry/data-plane";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

const InternalServiceToken = "integration-new-internal-service-token";
const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

const StartWorkflowInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    purpose: z.enum([
      SandboxInstancePurposes.SESSION,
      SandboxInstancePurposes.SNAPSHOT,
      SandboxInstancePurposes.SETUP_ASSISTANT,
      SandboxInstancePurposes.SETUP_CHECK,
    ]),
    image: z
      .object({
        imageId: z.string().min(1),
        createdAt: z.string().min(1).optional(),
        kind: z.enum(["base", "snapshot"]),
        provider: z.enum(["docker", "e2b", "tensorlake"]).optional(),
      })
      .strict(),
  })
  .loose();

const ResumeWorkflowInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
  })
  .loose();

describe.concurrent("internal sandbox instance start and resume integration", () => {
  it("queues a start workflow and creates a pending sandbox instance", async ({ env }) => {
    const workflowInput = startInput({
      organizationId: "org_dp_api_start_workflow",
      sandboxProfileId: "sbp_dp_api_start_workflow",
      sandboxProfileVersion: 7,
      purpose: SandboxInstancePurposes.SESSION,
      imageId: "im_dp_api_start_workflow",
    });

    const startedSandbox = await clientFor(env).startSandboxInstance(workflowInput);

    expect(startedSandbox).toEqual({
      status: "accepted",
      sandboxInstanceId: expect.stringMatching(/^sbi_[a-zA-Z0-9_-]+$/),
      workflowRunId: expect.any(String),
    });

    const workflowRuns = await waitForQueuedWorkflowRuns({
      env,
      workflowName: StartSandboxInstanceWorkflowName,
      inputEquals: {
        organizationId: workflowInput.organizationId,
        sandboxProfileId: workflowInput.sandboxProfileId,
      },
    });

    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]).toMatchObject({
      id: startedSandbox.workflowRunId,
      namespace_id: createDataPlaneWorkflowNamespaceId(env.id),
      workflow_name: StartSandboxInstanceWorkflowName,
      status: "pending",
      output: null,
    });

    const parsedInput = StartWorkflowInputSchema.parse(workflowRuns[0]?.input);
    expect(parsedInput).toMatchObject({
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
      sandboxProfileVersion: workflowInput.sandboxProfileVersion,
      purpose: SandboxInstancePurposes.SESSION,
      image: workflowInput.image,
    });

    await expect(readSandboxInstance(env, startedSandbox.sandboxInstanceId)).resolves.toEqual({
      id: startedSandbox.sandboxInstanceId,
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
      sandboxProfileVersion: workflowInput.sandboxProfileVersion,
      providerSandboxId: null,
      sandboxConnectionId: null,
      sandboxVcpuCount: null,
      sandboxMemoryMb: null,
      sandboxDiskMb: null,
      purpose: SandboxInstancePurposes.SESSION,
      status: SandboxInstanceStatuses.PENDING,
    });

    await expect(countPersistedRuntimePlans(env, startedSandbox.sandboxInstanceId)).resolves.toBe(
      0,
    );
  });

  it("persists the selected sandbox runtime config with the pending sandbox instance", async ({
    env,
  }) => {
    const workflowInput = startInput({
      organizationId: "org_dp_api_start_runtime_config",
      sandboxProfileId: "sbp_dp_api_start_runtime_config",
      sandboxProfileVersion: 8,
      purpose: SandboxInstancePurposes.SESSION,
      imageId: "im_dp_api_start_runtime_config",
      imageProvider: "e2b",
      sandboxConnectionId: "icn_dp_api_start_runtime_config",
      runtimeResources: {
        vcpuCount: 4,
        memoryMb: 8192,
      },
    });

    const startedSandbox = await clientFor(env).startSandboxInstance(workflowInput);

    await expect(readSandboxInstance(env, startedSandbox.sandboxInstanceId)).resolves.toMatchObject(
      {
        id: startedSandbox.sandboxInstanceId,
        sandboxConnectionId: "icn_dp_api_start_runtime_config",
        sandboxVcpuCount: 4,
        sandboxMemoryMb: 8192,
        sandboxDiskMb: null,
      },
    );
  });

  it("queues setup-check launches with setup-check purpose", async ({ env }) => {
    const workflowInput = startInput({
      organizationId: "org_dp_api_start_setup_check",
      sandboxProfileId: "sbp_dp_api_start_setup_check",
      sandboxProfileVersion: 3,
      purpose: SandboxInstancePurposes.SETUP_CHECK,
      imageId: "im_dp_api_start_setup_check",
    });

    const startedSandbox = await clientFor(env).startSandboxInstance(workflowInput);
    const workflowRuns = await waitForQueuedWorkflowRuns({
      env,
      workflowName: StartSandboxInstanceWorkflowName,
      inputEquals: {
        organizationId: workflowInput.organizationId,
        sandboxProfileId: workflowInput.sandboxProfileId,
      },
    });

    const parsedInput = StartWorkflowInputSchema.parse(workflowRuns[0]?.input);
    expect(parsedInput).toMatchObject({
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
      purpose: SandboxInstancePurposes.SETUP_CHECK,
    });
    await expect(readSandboxInstancePurpose(env, startedSandbox.sandboxInstanceId)).resolves.toBe(
      SandboxInstancePurposes.SETUP_CHECK,
    );
  });

  it("queues setup-assistant launches as startable sandboxes", async ({ env }) => {
    const workflowInput = startInput({
      organizationId: "org_dp_api_start_setup_assistant",
      sandboxProfileId: "sbp_dp_api_start_setup_assistant",
      sandboxProfileVersion: 4,
      purpose: SandboxInstancePurposes.SETUP_ASSISTANT,
      imageId: "im_dp_api_start_setup_assistant",
    });

    const startedSandbox = await clientFor(env).startSandboxInstance(workflowInput);
    const workflowRuns = await waitForQueuedWorkflowRuns({
      env,
      workflowName: StartSandboxInstanceWorkflowName,
      inputEquals: {
        organizationId: workflowInput.organizationId,
        sandboxProfileId: workflowInput.sandboxProfileId,
      },
    });

    const parsedInput = StartWorkflowInputSchema.parse(workflowRuns[0]?.input);
    expect(parsedInput).toMatchObject({
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
      purpose: SandboxInstancePurposes.SETUP_ASSISTANT,
    });
    await expect(readSandboxInstancePurpose(env, startedSandbox.sandboxInstanceId)).resolves.toBe(
      SandboxInstancePurposes.SETUP_ASSISTANT,
    );
  });

  it("queues snapshot launches with the snapshot image provider", async ({ env }) => {
    const workflowInput = startInput({
      organizationId: "org_dp_api_start_snapshot",
      sandboxProfileId: "sbp_dp_api_start_snapshot",
      sandboxProfileVersion: 9,
      purpose: SandboxInstancePurposes.SNAPSHOT,
      imageId: "snap_dp_api_start_snapshot",
      imageKind: "snapshot",
      imageProvider: "docker",
    });

    const startedSandbox = await clientFor(env).startSandboxInstance(workflowInput);
    const workflowRuns = await waitForQueuedWorkflowRuns({
      env,
      workflowName: StartSandboxInstanceWorkflowName,
      inputEquals: {
        organizationId: workflowInput.organizationId,
        sandboxProfileId: workflowInput.sandboxProfileId,
      },
    });

    const parsedInput = StartWorkflowInputSchema.parse(workflowRuns[0]?.input);
    expect(parsedInput).toMatchObject({
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
      image: {
        imageId: "snap_dp_api_start_snapshot",
        createdAt: "2026-02-27T00:00:00.000Z",
        kind: "snapshot",
        provider: "docker",
      },
    });
  });

  it("deduplicates duplicate start requests by idempotency key", async ({ env }) => {
    const workflowInput = startInput({
      organizationId: "org_dp_api_start_idempotent",
      sandboxProfileId: "sbp_dp_api_start_idempotent",
      sandboxProfileVersion: 11,
      purpose: SandboxInstancePurposes.SESSION,
      imageId: "im_dp_api_start_idempotent",
      idempotencyKey: "dashboard-start-integration-new",
    });

    const firstResponse = await clientFor(env).startSandboxInstance(workflowInput);
    const secondResponse = await clientFor(env).startSandboxInstance(workflowInput);

    expect(secondResponse).toEqual(firstResponse);
    await expect(
      countQueuedWorkflows({
        env,
        workflowName: StartSandboxInstanceWorkflowName,
        inputEquals: {
          organizationId: workflowInput.organizationId,
          sandboxProfileId: workflowInput.sandboxProfileId,
        },
      }),
    ).resolves.toBe(1);
  });

  it("queues resume workflows and deduplicates duplicate requests by idempotency key", async ({
    env,
  }) => {
    const workflowInput: ResumeSandboxInstanceInput = {
      organizationId: "org_dp_api_resume_workflow",
      instanceId: "sbi_dp_api_resume_workflow",
      idempotencyKey: "dashboard-resume-integration-new",
    };

    await insertStoppedSandboxInstance(env, {
      organizationId: workflowInput.organizationId,
      sandboxInstanceId: workflowInput.instanceId,
    });

    const firstResponse = await clientFor(env).resumeSandboxInstance(workflowInput);
    const secondResponse = await clientFor(env).resumeSandboxInstance(workflowInput);

    expect(firstResponse).toEqual({
      status: "accepted",
      sandboxInstanceId: workflowInput.instanceId,
      workflowRunId: expect.any(String),
    });
    expect(secondResponse).toEqual(firstResponse);

    const workflowRuns = await waitForQueuedWorkflowRuns({
      env,
      workflowName: ResumeSandboxInstanceWorkflowName,
      inputEquals: {
        sandboxInstanceId: workflowInput.instanceId,
      },
    });

    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]).toMatchObject({
      id: firstResponse.workflowRunId,
      namespace_id: createDataPlaneWorkflowNamespaceId(env.id),
      workflow_name: ResumeSandboxInstanceWorkflowName,
      status: "pending",
      output: null,
    });
    expect(ResumeWorkflowInputSchema.parse(workflowRuns[0]?.input)).toMatchObject({
      sandboxInstanceId: workflowInput.instanceId,
    });
  });
});

function clientFor(env: IntegrationTestEnvironment): DataPlaneSandboxInstancesClient {
  return createDataPlaneSandboxInstancesClient({
    baseUrl: env.dataPlaneApi.hostBaseUrl,
    serviceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

function startInput(input: {
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  purpose:
    | typeof SandboxInstancePurposes.SESSION
    | typeof SandboxInstancePurposes.SNAPSHOT
    | typeof SandboxInstancePurposes.SETUP_ASSISTANT
    | typeof SandboxInstancePurposes.SETUP_CHECK;
  imageId: string;
  imageKind?: "base" | "snapshot";
  imageProvider?: "docker" | "e2b";
  idempotencyKey?: string;
  sandboxConnectionId?: string;
  runtimeResources?: {
    vcpuCount: number;
    memoryMb: number;
    diskMb?: number;
  };
}): StartSandboxInstanceInput {
  const imageKind = input.imageKind ?? "base";
  const imageProvider = input.imageProvider ?? "docker";

  return {
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    purpose: input.purpose,
    runtimePlan: runtimePlan({
      sandboxProfileId: input.sandboxProfileId,
      version: input.sandboxProfileVersion,
      imageKind,
      imageId: input.imageId,
    }),
    startedBy: {
      kind: "user",
      id: `usr_${input.sandboxProfileId}`,
    },
    source: "dashboard",
    image: {
      imageId: input.imageId,
      createdAt: "2026-02-27T00:00:00.000Z",
      kind: imageKind,
      provider: imageProvider,
    },
    sandboxRuntime: {
      provider: imageProvider,
      ...(input.sandboxConnectionId === undefined
        ? {}
        : { connectionId: input.sandboxConnectionId }),
      ...(input.runtimeResources === undefined ? {} : { resources: input.runtimeResources }),
    },
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  };
}

function runtimePlan(input: {
  sandboxProfileId: string;
  version: number;
  imageKind: "base" | "snapshot";
  imageId: string;
}): CompiledRuntimePlan {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image:
      input.imageKind === "base"
        ? {
            source: "base",
            imageRef: "registry:3",
          }
        : {
            source: "snapshot",
            imageRef: input.imageId,
          },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

async function insertStoppedSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_dp_api_resume_workflow",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STOPPED,
    startedByKind: "user",
    startedById: "usr_dp_api_resume_workflow",
    source: "dashboard",
  });

  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: runtimePlan({
      sandboxProfileId: "sbp_dp_api_resume_workflow",
      version: 1,
      imageKind: "base",
      imageId: "im_dp_api_resume_workflow",
    }),
    compiledFromProfileId: "sbp_dp_api_resume_workflow",
    compiledFromProfileVersion: 1,
  });
}

async function readSandboxInstance(env: IntegrationTestEnvironment, sandboxInstanceId: string) {
  return env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      organizationId: true,
      sandboxProfileId: true,
      sandboxProfileVersion: true,
      providerSandboxId: true,
      sandboxConnectionId: true,
      sandboxVcpuCount: true,
      sandboxMemoryMb: true,
      sandboxDiskMb: true,
      purpose: true,
      status: true,
    },
    where: (table, { eq }) => eq(table.id, sandboxInstanceId),
  });
}

async function readSandboxInstancePurpose(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
) {
  const row = await env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      purpose: true,
    },
    where: (table, { eq }) => eq(table.id, sandboxInstanceId),
  });

  return row?.purpose;
}

async function countPersistedRuntimePlans(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
): Promise<number> {
  const rows = await env.dataPlaneDb.query.sandboxInstanceRuntimePlans.findMany({
    columns: {
      id: true,
    },
    where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
  });

  return rows.length;
}

type WorkflowRunRow = {
  id: string;
  namespace_id: string;
  workflow_name: string;
  status: string;
  input: unknown;
  output: null;
};

const WorkflowRunRowSchema = z
  .object({
    id: z.string(),
    namespace_id: z.string(),
    workflow_name: z.string(),
    status: z.string(),
    input: z.unknown(),
    output: z.null(),
  })
  .strict();

async function waitForQueuedWorkflowRuns(input: {
  env: IntegrationTestEnvironment;
  workflowName: string;
  inputEquals: Record<string, unknown>;
}): Promise<WorkflowRunRow[]> {
  const deadline = systemClock.nowMs() + WorkflowRunPersistTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const result = await listQueuedWorkflows(input);
    if (result.length > 0) {
      return result;
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(`Timed out waiting for queued workflow '${input.workflowName}'.`);
}

async function countQueuedWorkflows(input: {
  env: IntegrationTestEnvironment;
  workflowName: string;
  inputEquals: Record<string, unknown>;
}): Promise<number> {
  return (await listQueuedWorkflows(input)).length;
}

async function listQueuedWorkflows(input: {
  env: IntegrationTestEnvironment;
  workflowName: string;
  inputEquals: Record<string, unknown>;
}): Promise<WorkflowRunRow[]> {
  const namespaceId = createDataPlaneWorkflowNamespaceId(input.env.id);
  const result = await input.env.dataPlaneDb.execute(sql<WorkflowRunRow>`
    select id, namespace_id, workflow_name, status, input, output
    from data_plane_openworkflow.workflow_runs
    where
      namespace_id = ${namespaceId}
      and workflow_name = ${input.workflowName}
      and input @> ${JSON.stringify(input.inputEquals)}::jsonb
    order by created_at asc
  `);

  return result.rows.map((row) => WorkflowRunRowSchema.parse(row));
}
