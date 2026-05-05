/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxInstancePersistenceModes, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  SandboxInstancesConflictResponseSchema,
  SandboxInstancesNotFoundResponseSchema,
  SandboxInstanceStatusResponseSchema,
} from "../src/sandbox-instances/index.js";
import { waitForQueuedResumeWorkflowInput } from "./helpers/data-plane-workflows.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

const CountRowSchema = z
  .object({
    count: z.string(),
  })
  .strict();

describe.concurrent("sandbox instance resume integration", () => {
  it("returns starting for a stopped sandbox and queues a resume workflow", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-resume-stopped@example.com",
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_resume_stopped_001",
      status: SandboxInstanceStatuses.STOPPED,
      startedById: session.userId,
    });
    await insertRuntimePlan(env, {
      sandboxInstanceId: "sbi_cp_resume_stopped_001",
    });

    const response = await resumeSandbox(env, {
      sandboxInstanceId: "sbi_cp_resume_stopped_001",
      cookie: session.cookie,
    });

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());
    expect(body).toMatchObject({
      id: "sbi_cp_resume_stopped_001",
      status: SandboxInstanceStatuses.STARTING,
      connectable: false,
      failureCode: null,
      failureMessage: null,
    });

    const workflowInput = await waitForQueuedResumeWorkflowInput({
      env,
      sandboxInstanceId: "sbi_cp_resume_stopped_001",
    });
    expect(workflowInput).toMatchObject({
      sandboxInstanceId: "sbi_cp_resume_stopped_001",
      actingUserId: session.userId,
    });
  });

  it("returns failed conflicts without queueing a resume workflow", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-resume-failed@example.com",
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_resume_failed_001",
      status: SandboxInstanceStatuses.FAILED,
      startedById: session.userId,
      failureCode: "sandbox_start_failed",
      failureMessage: "Initial start failed.",
    });

    const response = await resumeSandbox(env, {
      sandboxInstanceId: "sbi_cp_resume_failed_001",
      cookie: session.cookie,
    });

    expect(response.status).toBe(409);
    const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
    expect(body.code).toBe("INSTANCE_FAILED");
    expect(body.message).toContain("Initial start failed.");
    await expect(countQueuedResumeWorkflows(env, "sbi_cp_resume_failed_001")).resolves.toBe("0");
  });

  it("returns the current status for already-starting sandboxes without queueing resume", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-resume-starting@example.com",
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_resume_starting_001",
      status: SandboxInstanceStatuses.PENDING,
      startedById: session.userId,
    });

    const response = await resumeSandbox(env, {
      sandboxInstanceId: "sbi_cp_resume_starting_001",
      cookie: session.cookie,
    });

    expect(response.status).toBe(409);
    const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
    expect(body.code).toBe("INSTANCE_NOT_RESUMABLE");
    expect(body.message).toContain("is 'pending' and cannot be resumed");
    await expect(countQueuedResumeWorkflows(env, "sbi_cp_resume_starting_001")).resolves.toBe("0");
  });

  it("deduplicates repeated stopped-sandbox resume requests with the same idempotency key", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-resume-idempotent@example.com",
    });
    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_resume_idempotent_001",
      status: SandboxInstanceStatuses.STOPPED,
      startedById: session.userId,
    });
    await insertRuntimePlan(env, {
      sandboxInstanceId: "sbi_cp_resume_idempotent_001",
    });

    const request = {
      sandboxInstanceId: "sbi_cp_resume_idempotent_001",
      cookie: session.cookie,
      body: {
        idempotencyKey: "resume-stopped-idempotent-001",
      },
    };
    const firstResponse = await resumeSandbox(env, request);
    const secondResponse = await resumeSandbox(env, request);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    SandboxInstanceStatusResponseSchema.parse(await firstResponse.json());
    SandboxInstanceStatusResponseSchema.parse(await secondResponse.json());
    await waitForQueuedResumeWorkflowInput({
      env,
      sandboxInstanceId: "sbi_cp_resume_idempotent_001",
    });
    await expect(countQueuedResumeWorkflows(env, "sbi_cp_resume_idempotent_001")).resolves.toBe(
      "1",
    );
  });

  it("returns not found when the sandbox instance does not exist", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-resume-missing@example.com",
    });

    const response = await resumeSandbox(env, {
      sandboxInstanceId: "sbi_cp_resume_missing_001",
      cookie: session.cookie,
    });

    expect(response.status).toBe(404);
    const body = SandboxInstancesNotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("INSTANCE_NOT_FOUND");
  });
});

async function resumeSandbox(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    cookie: string;
    body?: Record<string, unknown>;
  },
) {
  return await env.controlPlaneApi.http.fetch(
    `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}/resume`,
    {
      method: "POST",
      headers: {
        cookie: input.cookie,
        ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    },
  );
}

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    status:
      | typeof SandboxInstanceStatuses.STOPPED
      | typeof SandboxInstanceStatuses.FAILED
      | typeof SandboxInstanceStatuses.PENDING;
    startedById: string;
    failureCode?: string;
    failureMessage?: string;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_resume_integration",
    title: null,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: null,
    persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
    status: input.status,
    startedByKind: "user",
    startedById: input.startedById,
    source: "dashboard",
    failureCode: input.failureCode ?? null,
    failureMessage: input.failureMessage ?? null,
  });
}

async function insertRuntimePlan(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: {
      sandboxProfileId: "sbp_resume_integration",
      version: 1,
      image: {
        source: "base",
        imageRef: "registry:resume",
      },
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
      workspaceSources: [],
      agentRuntimes: [],
    },
    compiledFromProfileId: "sbp_resume_integration",
    compiledFromProfileVersion: 1,
  });
}

async function countQueuedResumeWorkflows(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
): Promise<string> {
  const result = await env.dataPlaneDb.execute(sql<{ count: string }>`
    select count(*)::text as count
    from data_plane_openworkflow.workflow_runs
    where
      workflow_name = 'data-plane.sandbox-instances.resume'
      and input->>'sandboxInstanceId' = ${sandboxInstanceId}
  `);

  const row = result.rows[0];
  return row === undefined ? "0" : CountRowSchema.parse(row).count;
}
