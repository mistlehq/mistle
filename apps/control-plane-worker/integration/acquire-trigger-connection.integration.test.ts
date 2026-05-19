/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  TestEnvironmentIdHeader,
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
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

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: ensuredTriggerSandbox.sandboxInstanceId,
      organizationId: preparedTriggerRun.organizationId,
      sandboxProfileId: preparedTriggerRun.sandboxProfileId,
      sandboxProfileVersion: preparedTriggerRun.sandboxProfileVersion,
      runtimeProvider: "docker",
      providerSandboxId: "provider-acquire-connection-failed-sandbox",
      status: SandboxInstanceStatuses.FAILED,
      startedByKind: "system",
      startedById: "workflow_acquire_connection_failed_sandbox",
      source: "webhook",
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
