/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { SandboxProfileStatuses, SandboxProfileVersionStates } from "@mistle/db/control-plane";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  SandboxInstancesConflictResponseSchema,
  SandboxInstancesNotFoundResponseSchema,
  SandboxInstanceStatusResponseSchema,
} from "../src/sandbox-instances/index.js";
import { createApiKeyToken } from "./helpers/api-keys.js";
import { waitForQueuedResumeWorkflowInput } from "./helpers/data-plane-workflows.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

const CountRowSchema = z
  .object({
    count: z.string(),
  })
  .strict();

const execFileAsync = promisify(execFile);

describe.concurrent("sandbox instance resume integration", () => {
  it("returns starting for a stopped sandbox and queues a resume workflow", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-resume-stopped@example.com",
    });
    const providerSandboxId = await startDockerSandboxContainer();

    try {
      await insertSandboxInstance(env, {
        organizationId: session.organizationId,
        sandboxInstanceId: "sbi_cp_resume_stopped_001",
        status: SandboxInstanceStatuses.STOPPED,
        providerSandboxId,
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
    } finally {
      await destroyDockerSandboxContainer(providerSandboxId);
    }
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
    const providerSandboxId = await startDockerSandboxContainer();

    try {
      await insertSandboxInstance(env, {
        organizationId: session.organizationId,
        sandboxInstanceId: "sbi_cp_resume_idempotent_001",
        status: SandboxInstanceStatuses.STOPPED,
        providerSandboxId,
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
    } finally {
      await destroyDockerSandboxContainer(providerSandboxId);
    }
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

  it("resumes a stopped sandbox with API key auth", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-resume-api-key@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "Sandbox resumer",
      permissions: [OrganizationPermissions.SANDBOX_SESSION_RESUME],
    });
    const providerSandboxId = await startDockerSandboxContainer();

    try {
      await insertSandboxInstance(env, {
        organizationId: session.organizationId,
        sandboxInstanceId: "sbi_cp_resume_api_key_001",
        status: SandboxInstanceStatuses.STOPPED,
        providerSandboxId,
        startedById: session.userId,
      });
      await insertRuntimePlan(env, {
        sandboxInstanceId: "sbi_cp_resume_api_key_001",
      });

      const response = await resumeSandbox(env, {
        sandboxInstanceId: "sbi_cp_resume_api_key_001",
        bearerToken: token,
      });

      expect(response.status).toBe(200);
      const body = SandboxInstanceStatusResponseSchema.parse(await response.json());
      expect(body).toMatchObject({
        id: "sbi_cp_resume_api_key_001",
        status: SandboxInstanceStatuses.STARTING,
        connectable: false,
      });

      const workflowInput = await waitForQueuedResumeWorkflowInput({
        env,
        sandboxInstanceId: "sbi_cp_resume_api_key_001",
      });
      expect(workflowInput).toMatchObject({
        sandboxInstanceId: "sbi_cp_resume_api_key_001",
      });
      expect(workflowInput).not.toHaveProperty("actingUserId");
    } finally {
      await destroyDockerSandboxContainer(providerSandboxId);
    }
  });

  it("returns 403 when an API key lacks sandbox resume permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-resume-api-key-forbidden@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "Sandbox non-resumer",
      permissions: [OrganizationPermissions.SANDBOX_SESSION_READ],
    });

    const response = await resumeSandbox(env, {
      sandboxInstanceId: "sbi_cp_resume_api_key_forbidden_001",
      bearerToken: token,
    });

    expect(response.status).toBe(403);
  });
});

async function resumeSandbox(
  env: IntegrationTestEnvironment,
  input: {
    bearerToken?: string;
    sandboxInstanceId: string;
    cookie?: string;
    body?: Record<string, unknown>;
  },
) {
  return await env.controlPlaneApi.http.fetch(
    `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}/resume`,
    {
      method: "POST",
      headers: {
        ...(input.cookie === undefined ? {} : { cookie: input.cookie }),
        ...(input.bearerToken === undefined
          ? {}
          : { authorization: `Bearer ${input.bearerToken}` }),
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
    providerSandboxId?: string;
    failureCode?: string;
    failureMessage?: string;
  },
): Promise<void> {
  const sandboxProfileId = resumeSandboxProfileId(input.sandboxInstanceId);

  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfiles)
    .values({
      id: sandboxProfileId,
      organizationId: input.organizationId,
      displayName: "Resume integration profile",
      status: SandboxProfileStatuses.ACTIVE,
    })
    .onConflictDoNothing({
      target: env.controlPlaneTables.sandboxProfiles.id,
    });
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfileVersions)
    .values({
      sandboxProfileId,
      version: 1,
      state: SandboxProfileVersionStates.PUBLISHED,
      gitCommitSigningIntegrationConnectionId: null,
    })
    .onConflictDoNothing();

  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId,
    title: null,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: input.providerSandboxId ?? null,
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
  const sandboxProfileId = resumeSandboxProfileId(input.sandboxInstanceId);

  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: {
      sandboxProfileId,
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
    compiledFromProfileId: sandboxProfileId,
    compiledFromProfileVersion: 1,
  });
}

function resumeSandboxProfileId(sandboxInstanceId: string): string {
  return `sbp_${sandboxInstanceId}`;
}

async function startDockerSandboxContainer(): Promise<string> {
  const { stdout } = await execFileAsync("docker", ["run", "-d", "registry:3"]);
  const containerId = stdout.trim();
  if (containerId.length === 0) {
    throw new Error("Expected docker run to return a container id.");
  }

  return containerId;
}

async function destroyDockerSandboxContainer(containerId: string): Promise<void> {
  await execFileAsync("docker", ["rm", "-f", containerId]).catch(() => undefined);
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
