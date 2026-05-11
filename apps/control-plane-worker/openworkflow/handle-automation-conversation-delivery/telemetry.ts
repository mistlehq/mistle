import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";

import { logger } from "../../logger.js";

const AutomationConversationDeliveryTracer = trace.getTracer("@mistle/control-plane-worker");

export type AutomationConversationDeliveryTelemetryContext = {
  webhookEventId?: string | undefined;
  deliveryTaskId?: string | undefined;
  automationRunId?: string | undefined;
  conversationId?: string | undefined;
  workflowRunId?: string | undefined;
  sandboxInstanceId?: string | undefined;
  routeId?: string | undefined;
  attemptCount?: number | null | undefined;
  processorGeneration?: number | null | undefined;
};

type DeliveryTelemetryAttributeValue = string | number | boolean;
type DeliveryTaskLifecycleStatus = "claimed" | "delivering";

export function resolveAutomationConversationDeliveryTaskLifecycleEvent(input: {
  status: DeliveryTaskLifecycleStatus;
}): {
  eventName: string;
  message: string;
  attributes: Record<string, DeliveryTelemetryAttributeValue>;
} {
  if (input.status === "claimed") {
    return {
      eventName: "delivery_task.claimed",
      message: "Claimed automation conversation delivery task",
      attributes: {
        "mistle.delivery.task_resumed": false,
        "mistle.delivery.task_status": input.status,
      },
    };
  }

  return {
    eventName: "delivery_task.resumed",
    message: "Resumed in-progress automation conversation delivery task",
    attributes: {
      "mistle.delivery.task_resumed": true,
      "mistle.delivery.task_status": input.status,
    },
  };
}

export function createAutomationConversationDeliveryTelemetryAttributes(
  input: AutomationConversationDeliveryTelemetryContext,
): Record<string, DeliveryTelemetryAttributeValue> {
  return {
    ...(input.webhookEventId === undefined
      ? {}
      : { "mistle.webhook.event_id": input.webhookEventId }),
    ...(input.deliveryTaskId === undefined
      ? {}
      : { "mistle.delivery.task_id": input.deliveryTaskId }),
    ...(input.automationRunId === undefined
      ? {}
      : { "mistle.automation.run_id": input.automationRunId }),
    ...(input.conversationId === undefined
      ? {}
      : { "mistle.conversation.id": input.conversationId }),
    ...(input.workflowRunId === undefined ? {} : { "mistle.workflow.run_id": input.workflowRunId }),
    ...(input.sandboxInstanceId === undefined
      ? {}
      : { "mistle.sandbox.instance_id": input.sandboxInstanceId }),
    ...(input.routeId === undefined ? {} : { "mistle.route.id": input.routeId }),
    ...(input.attemptCount === undefined || input.attemptCount === null
      ? {}
      : { "mistle.delivery.attempt_count": input.attemptCount }),
    ...(input.processorGeneration === undefined || input.processorGeneration === null
      ? {}
      : { "mistle.delivery.processor_generation": input.processorGeneration }),
  };
}

export async function withAutomationConversationDeliverySpan<T>(
  input: {
    name: string;
    telemetryContext: AutomationConversationDeliveryTelemetryContext;
  },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return await AutomationConversationDeliveryTracer.startActiveSpan(input.name, async (span) => {
    span.setAttributes(
      createAutomationConversationDeliveryTelemetryAttributes(input.telemetryContext),
    );

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

export function logAutomationConversationDeliveryEvent(input: {
  eventName: string;
  message: string;
  telemetryContext: AutomationConversationDeliveryTelemetryContext;
  attributes?: Record<string, DeliveryTelemetryAttributeValue>;
  err?: unknown;
  level?: "info" | "error" | "warn";
}): void {
  logger[input.level ?? "info"](
    {
      eventName: input.eventName,
      ...createAutomationConversationDeliveryTelemetryAttributes(input.telemetryContext),
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
