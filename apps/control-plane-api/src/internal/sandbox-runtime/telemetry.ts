import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";

const SandboxRuntimeTracer = trace.getTracer("@mistle/control-plane-api");

type SandboxRuntimeTelemetryAttributeValue = string | number | boolean;

export type SandboxRuntimeTelemetryContext = {
  sandboxInstanceId?: string | undefined;
  webhookEventId?: string | undefined;
  deliveryTaskId?: string | undefined;
  externalDeliveryId?: string | undefined;
  triggerRunId?: string | undefined;
  conversationId?: string | undefined;
};

export function createSandboxRuntimeTelemetryAttributes(
  input: SandboxRuntimeTelemetryContext,
): Record<string, SandboxRuntimeTelemetryAttributeValue> {
  return {
    ...(input.sandboxInstanceId === undefined
      ? {}
      : { "mistle.sandbox.instance_id": input.sandboxInstanceId }),
    ...(input.webhookEventId === undefined
      ? {}
      : { "mistle.webhook.event_id": input.webhookEventId }),
    ...(input.deliveryTaskId === undefined
      ? {}
      : { "mistle.delivery.task_id": input.deliveryTaskId }),
    ...(input.externalDeliveryId === undefined
      ? {}
      : { "mistle.webhook.external_delivery_id": input.externalDeliveryId }),
    ...(input.triggerRunId === undefined ? {} : { "mistle.trigger.run_id": input.triggerRunId }),
    ...(input.conversationId === undefined
      ? {}
      : { "mistle.conversation.id": input.conversationId }),
  };
}

export async function withSandboxRuntimeSpan<T>(
  input: {
    name: string;
    telemetryContext: SandboxRuntimeTelemetryContext;
  },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return await SandboxRuntimeTracer.startActiveSpan(input.name, async (span) => {
    span.setAttributes(createSandboxRuntimeTelemetryAttributes(input.telemetryContext));

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
