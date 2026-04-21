import { logger } from "../../logger.js";

type WebhookDeliveryTelemetryAttributeValue = string | number | boolean;

export type WebhookDeliveryTelemetryContext = {
  webhookEventId?: string | undefined;
  externalDeliveryId?: string | undefined;
  automationRunId?: string | undefined;
  conversationId?: string | undefined;
  deliveryTaskId?: string | undefined;
  targetKey?: string | undefined;
  integrationConnectionId?: string | undefined;
};

export function createWebhookDeliveryTelemetryAttributes(
  input: WebhookDeliveryTelemetryContext,
): Record<string, WebhookDeliveryTelemetryAttributeValue> {
  return {
    ...(input.webhookEventId === undefined
      ? {}
      : { "mistle.webhook.event_id": input.webhookEventId }),
    ...(input.externalDeliveryId === undefined
      ? {}
      : { "mistle.webhook.external_delivery_id": input.externalDeliveryId }),
    ...(input.automationRunId === undefined
      ? {}
      : { "mistle.automation.run_id": input.automationRunId }),
    ...(input.conversationId === undefined
      ? {}
      : { "mistle.conversation.id": input.conversationId }),
    ...(input.deliveryTaskId === undefined
      ? {}
      : { "mistle.delivery.task_id": input.deliveryTaskId }),
    ...(input.targetKey === undefined ? {} : { "mistle.integration.target_key": input.targetKey }),
    ...(input.integrationConnectionId === undefined
      ? {}
      : { "mistle.integration.connection_id": input.integrationConnectionId }),
  };
}

export function logWebhookDeliveryEvent(input: {
  eventName: string;
  message: string;
  telemetryContext: WebhookDeliveryTelemetryContext;
  attributes?: Record<string, WebhookDeliveryTelemetryAttributeValue>;
  err?: unknown;
  level?: "info" | "warn" | "error";
}): void {
  logger[input.level ?? "info"](
    {
      eventName: input.eventName,
      ...createWebhookDeliveryTelemetryAttributes(input.telemetryContext),
      ...input.attributes,
      ...(input.err === undefined ? {} : { err: input.err }),
    },
    input.message,
  );
}
