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

import { acquireAutomationConnection } from "../openworkflow/handle-automation-conversation-delivery/acquire-automation-connection.js";
import type {
  EnsuredAutomationSandbox,
  PreparedAutomationRun,
} from "../openworkflow/shared/automation-run-types.js";
import { AutomationRunFailureCodes } from "../openworkflow/shared/automation-run.js";

const InternalServiceToken = "integration-new-internal-service-token";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("control-plane worker automation connection acquisition", () => {
  it("fails through the real control-plane internal API when the sandbox is terminal", async ({
    env,
  }) => {
    const preparedAutomationRun = createPreparedAutomationRun({
      suffix: "failed_sandbox",
      organizationId: "org_acquire_connection_failed_sandbox",
    });
    const ensuredAutomationSandbox: EnsuredAutomationSandbox = {
      sandboxInstanceId: "sbi_acquire_connection_failed_sandbox",
      startupWorkflowRunId: null,
    };

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: ensuredAutomationSandbox.sandboxInstanceId,
      organizationId: preparedAutomationRun.organizationId,
      sandboxProfileId: preparedAutomationRun.sandboxProfileId,
      sandboxProfileVersion: preparedAutomationRun.sandboxProfileVersion,
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
      acquireAutomationConnection(
        {
          controlPlaneInternalClient: createControlPlaneInternalClient(env),
        },
        {
          preparedAutomationRun,
          ensuredAutomationSandbox,
          deliveryTaskId: "cdt_acquire_connection_failed_sandbox",
          workflowRunId: "owfr_acquire_connection_failed_sandbox",
        },
      ),
    ).rejects.toMatchObject({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: "Sandbox startup failed before connection acquisition.",
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

function createPreparedAutomationRun(input: {
  suffix: string;
  organizationId: string;
}): PreparedAutomationRun {
  return {
    automationRunId: `aru_acquire_connection_${input.suffix}`,
    automationRunCreatedAt: "2026-04-23T00:00:00.000Z",
    automationId: `atm_acquire_connection_${input.suffix}`,
    conversationId: `cnv_acquire_connection_${input.suffix}`,
    automationTargetId: `atg_acquire_connection_${input.suffix}`,
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
