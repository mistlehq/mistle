import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";

import { logger } from "../../logger.js";

const WebhookDeliveryTracer = trace.getTracer("@mistle/control-plane-worker");

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

export async function withWebhookDeliverySpan<T>(
  input: {
    name: string;
    telemetryContext: WebhookDeliveryTelemetryContext;
  },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return await WebhookDeliveryTracer.startActiveSpan(input.name, async (span) => {
    span.setAttributes(createWebhookDeliveryTelemetryAttributes(input.telemetryContext));

    try {
      return await fn(span);
    } catch (error) {
      span.recordException(toRecordableError(error));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

function toRecordableError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
