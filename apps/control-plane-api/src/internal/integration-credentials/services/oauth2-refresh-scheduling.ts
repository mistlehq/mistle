import type { IntegrationOAuth2AuthorizationCodeCapability } from "@mistle/integrations-core";
import { RefreshIntegrationConnectionOAuth2CredentialWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import type { OpenWorkflow } from "openworkflow";

import { logger } from "../../../logger.js";

export const OAuth2RefreshScheduleBufferMs = 5 * 60 * 1_000;

export function createOAuth2RefreshWorkflowIdempotencyKey(input: {
  connectionId: string;
  scheduledFor: Date;
}): string {
  return `integration-connection-oauth2-refresh:${input.connectionId}:${input.scheduledFor.toISOString()}`;
}

export function resolveScheduledOAuth2CredentialRefreshAt(input: {
  oauth2AuthorizationCode: IntegrationOAuth2AuthorizationCodeCapability;
  refreshSchedulingResponse: unknown;
}): Date | undefined {
  if (input.oauth2AuthorizationCode.resolveNextRefresh === undefined) {
    return undefined;
  }

  return input.oauth2AuthorizationCode.resolveNextRefresh({
    buffer: OAuth2RefreshScheduleBufferMs,
    logger,
    now: () => new Date(),
    response: input.refreshSchedulingResponse,
  });
}

export async function scheduleOAuth2CredentialRefresh(input: {
  openWorkflow: Pick<OpenWorkflow, "runWorkflow">;
  organizationId: string;
  connectionId: string;
  nextRefreshAt: Date | undefined;
}): Promise<void> {
  if (input.nextRefreshAt === undefined) {
    return;
  }

  await input.openWorkflow.runWorkflow(
    RefreshIntegrationConnectionOAuth2CredentialWorkflowSpec,
    {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
    },
    {
      availableAt: input.nextRefreshAt,
      idempotencyKey: createOAuth2RefreshWorkflowIdempotencyKey({
        connectionId: input.connectionId,
        scheduledFor: input.nextRefreshAt,
      }),
    },
  );
}
