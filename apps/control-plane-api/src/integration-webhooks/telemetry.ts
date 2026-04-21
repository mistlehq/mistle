import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";

import { logger } from "../logger.js";

const IntegrationWebhookTracer = trace.getTracer("@mistle/control-plane-api");

type IntegrationWebhookTelemetryAttributeValue = string | number | boolean;

export type IntegrationWebhookTelemetryContext = {
  webhookEventId?: string | undefined;
  externalDeliveryId?: string | undefined;
  integrationConnectionId?: string | undefined;
  targetKey?: string | undefined;
  endpointKey?: string | undefined;
};

export function createIntegrationWebhookTelemetryAttributes(
  input: IntegrationWebhookTelemetryContext,
): Record<string, IntegrationWebhookTelemetryAttributeValue> {
  return {
    ...(input.webhookEventId === undefined
      ? {}
      : { "mistle.webhook.event_id": input.webhookEventId }),
    ...(input.externalDeliveryId === undefined
      ? {}
      : { "mistle.webhook.external_delivery_id": input.externalDeliveryId }),
    ...(input.integrationConnectionId === undefined
      ? {}
      : { "mistle.integration.connection_id": input.integrationConnectionId }),
    ...(input.targetKey === undefined ? {} : { "mistle.integration.target_key": input.targetKey }),
    ...(input.endpointKey === undefined
      ? {}
      : { "mistle.webhook.endpoint_key": input.endpointKey }),
  };
}

export async function withIntegrationWebhookSpan<T>(
  input: {
    name: string;
    telemetryContext: IntegrationWebhookTelemetryContext;
  },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return await IntegrationWebhookTracer.startActiveSpan(input.name, async (span) => {
    span.setAttributes(createIntegrationWebhookTelemetryAttributes(input.telemetryContext));

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

export function logIntegrationWebhookEvent(input: {
  eventName: string;
  message: string;
  telemetryContext: IntegrationWebhookTelemetryContext;
  attributes?: Record<string, IntegrationWebhookTelemetryAttributeValue>;
  err?: unknown;
  level?: "info" | "warn" | "error";
}): void {
  logger[input.level ?? "info"](
    {
      eventName: input.eventName,
      ...createIntegrationWebhookTelemetryAttributes(input.telemetryContext),
      ...input.attributes,
      ...(input.err === undefined ? {} : { err: input.err }),
    },
    input.message,
  );
}

function toRecordableError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
