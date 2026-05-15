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

import {
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictResponseSchema,
  SandboxInstancesNotFoundResponseSchema,
} from "../src/sandbox-instances/index.js";
import { stopSandboxInstanceResponseSchema } from "../src/sandbox-instances/stop-sandbox-instance/schema.js";
import { waitForQueuedUserStopWorkflowRun } from "./helpers/data-plane-workflows.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("sandbox instances stop integration", () => {
  it("queues a user stop workflow for setup-check sandboxes through the public route", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-stop-setup-check@example.com",
    });

    await insertSandboxInstance(env, {
      sandboxInstanceId: "sbi_cp_stop_setup_check",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_cp_stop_setup_check",
      purpose: SandboxInstancePurposes.SETUP_CHECK,
      status: SandboxInstanceStatuses.RUNNING,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_stop_setup_check/stop",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: "dashboard-setup-check-stop-001",
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = stopSandboxInstanceResponseSchema.parse(await response.json());
    expect(body).toEqual({
      status: "accepted",
      sandboxInstanceId: "sbi_cp_stop_setup_check",
      workflowRunId: expect.any(String),
    });

    const workflowRun = await waitForQueuedUserStopWorkflowRun({
      env,
      sandboxInstanceId: "sbi_cp_stop_setup_check",
    });
    expect(workflowRun.id).toBe(body.workflowRunId);
    expect(workflowRun.input).toEqual({
      sandboxInstanceId: "sbi_cp_stop_setup_check",
      stopReason: "user",
    });
  });

  it("queues a user stop workflow for setup-assistant sandboxes through the public route", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-stop-setup-assistant@example.com",
    });

    await insertSandboxInstance(env, {
      sandboxInstanceId: "sbi_cp_stop_setup_assistant",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_cp_stop_setup_assistant",
      purpose: SandboxInstancePurposes.SETUP_ASSISTANT,
      status: SandboxInstanceStatuses.RUNNING,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_stop_setup_assistant/stop",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: "dashboard-setup-assistant-stop-001",
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = stopSandboxInstanceResponseSchema.parse(await response.json());
    expect(body).toEqual({
      status: "accepted",
      sandboxInstanceId: "sbi_cp_stop_setup_assistant",
      workflowRunId: expect.any(String),
    });

    const workflowRun = await waitForQueuedUserStopWorkflowRun({
      env,
      sandboxInstanceId: "sbi_cp_stop_setup_assistant",
    });
    expect(workflowRun.id).toBe(body.workflowRunId);
    expect(workflowRun.input).toEqual({
      sandboxInstanceId: "sbi_cp_stop_setup_assistant",
      stopReason: "user",
    });
  });

  it("returns 409 when the public stop route targets a session sandbox", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-stop-session@example.com",
    });

    await insertSandboxInstance(env, {
      sandboxInstanceId: "sbi_cp_stop_session",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_cp_stop_session",
      purpose: SandboxInstancePurposes.SESSION,
      status: SandboxInstanceStatuses.RUNNING,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_stop_session/stop",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: "dashboard-session-stop-001",
        }),
      },
    );

    expect(response.status).toBe(409);
    const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
    expect(body.code).toBe(SandboxInstancesConflictCodes.INSTANCE_STOP_NOT_SUPPORTED);
  });

  it("returns 404 when the public stop route targets another organization's sandbox", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-stop-other-org@example.com",
    });
    const otherSession = await env.auth.createSession({
      email: "integration-new-sandbox-instances-stop-other-org-owner@example.com",
    });

    await insertSandboxInstance(env, {
      sandboxInstanceId: "sbi_cp_stop_other_org",
      organizationId: otherSession.organizationId,
      sandboxProfileId: "sbp_cp_stop_other_org",
      purpose: SandboxInstancePurposes.SETUP_CHECK,
      status: SandboxInstanceStatuses.RUNNING,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_stop_other_org/stop",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: "dashboard-other-org-stop-001",
        }),
      },
    );

    expect(response.status).toBe(404);
    const body = SandboxInstancesNotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("INSTANCE_NOT_FOUND");
  });
});

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    organizationId: string;
    sandboxProfileId: string;
    purpose:
      | typeof SandboxInstancePurposes.SESSION
      | typeof SandboxInstancePurposes.SETUP_ASSISTANT
      | typeof SandboxInstancePurposes.SETUP_CHECK;
    status: typeof SandboxInstanceStatuses.RUNNING;
  },
): Promise<void> {
  const row: DataPlaneTables["sandboxInstances"]["$inferInsert"] = {
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: input.status,
    startedByKind: "user",
    startedById: "usr_cp_stop",
    source: "dashboard",
    purpose: input.purpose,
  };

  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(row);
}
