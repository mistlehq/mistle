/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import { deleteSandboxInstanceResponseSchema } from "../src/sandbox-instances/delete-sandbox-instance/schema.js";
import { SandboxInstancesNotFoundResponseSchema } from "../src/sandbox-instances/index.js";
import { createApiKeyToken } from "./helpers/api-keys.js";
import {
  countQueuedDeleteWorkflowRuns,
  waitForQueuedDeleteWorkflowRun,
} from "./helpers/data-plane-workflows.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("sandbox instances delete integration", () => {
  it("deletes a running session through the public route and hides it from ordinary reads", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-delete-running@example.com",
    });

    await insertSandboxInstance(env, {
      sandboxInstanceId: "sbi_cp_delete_running_001",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_cp_delete_running_001",
      status: SandboxInstanceStatuses.RUNNING,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_delete_running_001",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = deleteSandboxInstanceResponseSchema.parse(await response.json());
    expect(body).toEqual({
      status: "deleted",
      sandboxInstanceId: "sbi_cp_delete_running_001",
      workflowRunId: expect.any(String),
    });

    const workflowRun = await waitForQueuedDeleteWorkflowRun({
      env,
      sandboxInstanceId: "sbi_cp_delete_running_001",
    });
    expect(workflowRun.id).toBe(body.workflowRunId);
    expect(workflowRun.input).toEqual({
      sandboxInstanceId: "sbi_cp_delete_running_001",
    });

    const deletedSandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        deletedAt: true,
        status: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_cp_delete_running_001"),
    });
    expect(deletedSandboxInstance).toMatchObject({
      status: SandboxInstanceStatuses.RUNNING,
      deletedAt: expect.any(String),
    });

    const getResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_delete_running_001",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(getResponse.status).toBe(404);
    const getBody = SandboxInstancesNotFoundResponseSchema.parse(await getResponse.json());
    expect(getBody.code).toBe("INSTANCE_NOT_FOUND");
  });

  it("returns already_deleted when the public route targets a deleted session", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-delete-already-deleted@example.com",
    });

    await insertSandboxInstance(env, {
      sandboxInstanceId: "sbi_cp_delete_already_deleted_001",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_cp_delete_already_deleted_001",
      status: SandboxInstanceStatuses.STOPPED,
      deletedAt: "2026-03-21T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_delete_already_deleted_001",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = deleteSandboxInstanceResponseSchema.parse(await response.json());
    expect(body).toEqual({
      status: "already_deleted",
      sandboxInstanceId: "sbi_cp_delete_already_deleted_001",
      workflowRunId: null,
    });
  });

  it("returns 404 when deleting another organization's session", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-delete-other-org@example.com",
    });
    const otherSession = await env.auth.createSession({
      email: "integration-new-sandbox-instances-delete-other-org-owner@example.com",
    });

    await insertSandboxInstance(env, {
      sandboxInstanceId: "sbi_cp_delete_other_org_001",
      organizationId: otherSession.organizationId,
      sandboxProfileId: "sbp_cp_delete_other_org_001",
      status: SandboxInstanceStatuses.RUNNING,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_delete_other_org_001",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const body = SandboxInstancesNotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("INSTANCE_NOT_FOUND");
  });

  it("returns 404 when the public session delete route targets a non-session sandbox", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-delete-non-session@example.com",
    });

    await insertSandboxInstance(env, {
      sandboxInstanceId: "sbi_cp_delete_non_session_001",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_cp_delete_non_session_001",
      status: SandboxInstanceStatuses.RUNNING,
      purpose: SandboxInstancePurposes.SKILLS_DISCOVERY,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_delete_non_session_001",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const body = SandboxInstancesNotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("INSTANCE_NOT_FOUND");

    await expect(
      countQueuedDeleteWorkflowRuns({
        env,
        sandboxInstanceId: "sbi_cp_delete_non_session_001",
      }),
    ).resolves.toBe(0);
  });

  it("returns 403 when an API key lacks sandbox session delete permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-delete-api-key-forbidden@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "Sandbox instance non-deleter",
      permissions: [OrganizationPermissions.SANDBOX_SESSION_READ],
    });

    await insertSandboxInstance(env, {
      sandboxInstanceId: "sbi_cp_delete_api_key_forbidden_001",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_cp_delete_api_key_forbidden_001",
      status: SandboxInstanceStatuses.RUNNING,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_delete_api_key_forbidden_001",
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    expect(response.status).toBe(403);
  });

  it("deletes a session for an API key with sandbox session delete permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-delete-api-key@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "Sandbox instance deleter",
      permissions: [OrganizationPermissions.SANDBOX_SESSION_DELETE],
    });

    await insertSandboxInstance(env, {
      sandboxInstanceId: "sbi_cp_delete_api_key_001",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_cp_delete_api_key_001",
      status: SandboxInstanceStatuses.STOPPED,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_delete_api_key_001",
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = deleteSandboxInstanceResponseSchema.parse(await response.json());
    expect(body).toEqual({
      status: "deleted",
      sandboxInstanceId: "sbi_cp_delete_api_key_001",
      workflowRunId: expect.any(String),
    });

    const workflowRun = await waitForQueuedDeleteWorkflowRun({
      env,
      sandboxInstanceId: "sbi_cp_delete_api_key_001",
    });
    expect(workflowRun.id).toBe(body.workflowRunId);
    expect(workflowRun.input).toEqual({
      sandboxInstanceId: "sbi_cp_delete_api_key_001",
    });

    const deletedSandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        deletedAt: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_cp_delete_api_key_001"),
    });
    expect(deletedSandboxInstance?.deletedAt).toEqual(expect.any(String));
  });
});

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    organizationId: string;
    sandboxProfileId: string;
    status: typeof SandboxInstanceStatuses.RUNNING | typeof SandboxInstanceStatuses.STOPPED;
    purpose?:
      | typeof SandboxInstancePurposes.SESSION
      | typeof SandboxInstancePurposes.SKILLS_DISCOVERY;
    deletedAt?: string;
  },
): Promise<void> {
  const row: DataPlaneTables["sandboxInstances"]["$inferInsert"] = {
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId:
      input.status === SandboxInstanceStatuses.RUNNING
        ? `provider-${input.sandboxInstanceId}`
        : null,
    status: input.status,
    startedByKind: "user",
    startedById: "usr_cp_delete",
    source: "dashboard",
    purpose: input.purpose ?? SandboxInstancePurposes.SESSION,
    deletedAt: input.deletedAt,
  };

  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(row);
}
