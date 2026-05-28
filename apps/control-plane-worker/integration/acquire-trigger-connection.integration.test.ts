/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePersistenceModes,
  SandboxInstanceStatuses,
  type SandboxInstanceStatus,
} from "@mistle/db/data-plane";
import {
  TestEnvironmentIdHeader,
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { ResumeSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";

import { acquireTriggerConnection } from "../openworkflow/handle-trigger-conversation-delivery/acquire-trigger-connection.js";
import type {
  EnsuredTriggerSandbox,
  PreparedTriggerRun,
} from "../openworkflow/shared/trigger-run-types.js";
import { TriggerRunFailureCodes } from "../openworkflow/shared/trigger-run.js";

const InternalServiceToken = "integration-new-internal-service-token";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("control-plane worker trigger connection acquisition", () => {
  it("fails explicitly when a sandbox remains stopping during connection acquisition", async ({
    env,
  }) => {
    const preparedTriggerRun = createPreparedTriggerRun({
      suffix: "stopping_sandbox",
      organizationId: "org_acquire_connection_stopping_sandbox",
    });
    const ensuredTriggerSandbox: EnsuredTriggerSandbox = {
      sandboxInstanceId: "sbi_acquire_connection_stopping_sandbox",
      startupWorkflowRunId: null,
    };

    await insertSandboxInstance(env, {
      preparedTriggerRun,
      sandboxInstanceId: ensuredTriggerSandbox.sandboxInstanceId,
      status: SandboxInstanceStatuses.STOPPING,
    });

    await expect(
      acquireTriggerConnection(
        {
          controlPlaneInternalClient: createControlPlaneInternalClient(env),
        },
        {
          preparedTriggerRun,
          ensuredTriggerSandbox,
          deliveryTaskId: "cdt_acquire_connection_stopping_sandbox",
          workflowRunId: "owfr_acquire_connection_stopping_sandbox",
          timing: {
            timeoutMs: 150,
            pollIntervalMs: 25,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: `Sandbox instance '${ensuredTriggerSandbox.sandboxInstanceId}' remained in non-deliverable status '${SandboxInstanceStatuses.STOPPING}' before the trigger timeout elapsed.`,
      metadata: {
        "mistle.sandbox.instance_id": ensuredTriggerSandbox.sandboxInstanceId,
        "mistle.sandbox.status": SandboxInstanceStatuses.STOPPING,
        "mistle.sandbox.wait_phase": "startup",
      },
    });
    await expectResumeWorkflowRunCount(env, ensuredTriggerSandbox.sandboxInstanceId, "0");
  });

  it("requests resume once for a stopped sandbox while waiting for it to become running", async ({
    env,
  }) => {
    const preparedTriggerRun = createPreparedTriggerRun({
      suffix: "stopped_sandbox",
      organizationId: "org_acquire_connection_stopped_sandbox",
    });
    const ensuredTriggerSandbox: EnsuredTriggerSandbox = {
      sandboxInstanceId: "sbi_acquire_connection_stopped_sandbox",
      startupWorkflowRunId: null,
    };

    await insertSandboxInstance(env, {
      preparedTriggerRun,
      sandboxInstanceId: ensuredTriggerSandbox.sandboxInstanceId,
      status: SandboxInstanceStatuses.STOPPED,
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      providerSandboxId: null,
    });

    await expect(
      acquireTriggerConnection(
        {
          controlPlaneInternalClient: createControlPlaneInternalClient(env),
        },
        {
          preparedTriggerRun,
          ensuredTriggerSandbox,
          deliveryTaskId: "cdt_acquire_connection_stopped_sandbox",
          workflowRunId: "owfr_acquire_connection_stopped_sandbox",
          timing: {
            timeoutMs: 150,
            pollIntervalMs: 25,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: `Sandbox instance '${ensuredTriggerSandbox.sandboxInstanceId}' did not become ready before the trigger timeout elapsed.`,
      metadata: {
        "mistle.sandbox.instance_id": ensuredTriggerSandbox.sandboxInstanceId,
        "mistle.sandbox.status": SandboxInstanceStatuses.STOPPED,
        "mistle.sandbox.wait_phase": "resume",
      },
    });
    await expectResumeWorkflowRunCount(env, ensuredTriggerSandbox.sandboxInstanceId, "1");
  });

  it("fails through the real control-plane internal API when the sandbox is terminal", async ({
    env,
  }) => {
    const preparedTriggerRun = createPreparedTriggerRun({
      suffix: "failed_sandbox",
      organizationId: "org_acquire_connection_failed_sandbox",
    });
    const ensuredTriggerSandbox: EnsuredTriggerSandbox = {
      sandboxInstanceId: "sbi_acquire_connection_failed_sandbox",
      startupWorkflowRunId: null,
    };

    await insertSandboxInstance(env, {
      preparedTriggerRun,
      sandboxInstanceId: ensuredTriggerSandbox.sandboxInstanceId,
      status: SandboxInstanceStatuses.FAILED,
      failureCode: "sandbox_start_failed",
      failureMessage: "Sandbox startup failed before connection acquisition.",
    });

    await expect(
      acquireTriggerConnection(
        {
          controlPlaneInternalClient: createControlPlaneInternalClient(env),
        },
        {
          preparedTriggerRun,
          ensuredTriggerSandbox,
          deliveryTaskId: "cdt_acquire_connection_failed_sandbox",
          workflowRunId: "owfr_acquire_connection_failed_sandbox",
        },
      ),
    ).rejects.toMatchObject({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: "Sandbox startup failed before connection acquisition.",
      metadata: {
        "mistle.sandbox.instance_id": ensuredTriggerSandbox.sandboxInstanceId,
        "mistle.sandbox.status": SandboxInstanceStatuses.FAILED,
        "mistle.sandbox.failure_code": "sandbox_start_failed",
        "mistle.sandbox.failure_message": "Sandbox startup failed before connection acquisition.",
        "mistle.sandbox.wait_phase": "startup",
      },
    });
  });
});

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    preparedTriggerRun: PreparedTriggerRun;
    sandboxInstanceId: string;
    status: SandboxInstanceStatus;
    persistenceMode?:
      | typeof SandboxInstancePersistenceModes.EPHEMERAL
      | typeof SandboxInstancePersistenceModes.PERSISTENT;
    providerSandboxId?: string | null;
    failureCode?: string;
    failureMessage?: string;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.preparedTriggerRun.organizationId,
    sandboxProfileId: input.preparedTriggerRun.sandboxProfileId,
    sandboxProfileVersion: input.preparedTriggerRun.sandboxProfileVersion,
    runtimeProvider: "docker",
    providerSandboxId: input.providerSandboxId ?? `provider-${input.sandboxInstanceId}`,
    status: input.status,
    persistenceMode: input.persistenceMode ?? SandboxInstancePersistenceModes.EPHEMERAL,
    startedByKind: "system",
    startedById: `workflow_${input.sandboxInstanceId}`,
    source: "webhook",
    ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
    ...(input.failureMessage === undefined ? {} : { failureMessage: input.failureMessage }),
  });
}

async function expectResumeWorkflowRunCount(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
  expectedCount: string,
): Promise<void> {
  const result = await env.dataPlaneDb.execute(
    sql<{ count: string }>`
      select count(*)::text as count
      from data_plane_openworkflow.workflow_runs
      where workflow_name = ${ResumeSandboxInstanceWorkflowSpec.name}
        and input->>'sandboxInstanceId' = ${sandboxInstanceId}
    `,
  );

  expect(result.rows).toEqual([{ count: expectedCount }]);
}

function createControlPlaneInternalClient(
  env: IntegrationTestEnvironment,
): ControlPlaneInternalClient {
  return new ControlPlaneInternalClient({
    baseUrl: env.controlPlaneApi.hostBaseUrl,
    internalAuthServiceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

function createPreparedTriggerRun(input: {
  suffix: string;
  organizationId: string;
}): PreparedTriggerRun {
  return {
    triggerRunId: `aru_acquire_connection_${input.suffix}`,
    triggerRunCreatedAt: "2026-04-23T00:00:00.000Z",
    triggerId: `atm_acquire_connection_${input.suffix}`,
    conversationId: `cnv_acquire_connection_${input.suffix}`,
    triggerTargetId: `atg_acquire_connection_${input.suffix}`,
    organizationId: input.organizationId,
    sandboxProfileId: `sbp_acquire_connection_${input.suffix}`,
    sandboxProfileVersion: 1,
    primaryRepositoryId: null,
    workingDirectory: "/root",
    sourceKind: "webhook",
    sourceOrderKey: "2026-04-23T00:00:00Z#0001",
    sourceWebhookEventId: `iwe_acquire_connection_${input.suffix}`,
    sourceScheduledActionId: undefined,
    integrationConnectionId: `icn_acquire_connection_${input.suffix}`,
    targetKey: "openai-agent-test",
    webhookEventId: `iwe_acquire_connection_${input.suffix}`,
    webhookEventType: "slack:app_mention",
    webhookProviderEventType: "app_mention",
    webhookExternalEventId: `evt_acquire_connection_${input.suffix}`,
    webhookExternalDeliveryId: `delivery_acquire_connection_${input.suffix}`,
    webhookPayload: {},
    scheduledActionId: undefined,
    scheduledAt: undefined,
    localScheduledDate: undefined,
    localScheduledTime: undefined,
    renderedInput: "Handle this webhook",
    renderedConversationKey: "conversation-key",
    renderedIdempotencyKey: `delivery_acquire_connection_${input.suffix}`,
    instructions: null,
    collaborationModeSettings: null,
  };
}
