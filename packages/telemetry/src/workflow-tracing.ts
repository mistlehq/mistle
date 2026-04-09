import {
  SpanStatusCode,
  context,
  defaultTextMapGetter,
  defaultTextMapSetter,
  trace,
  type Context,
} from "@opentelemetry/api";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = {
  [key: string]: JsonValue;
};

type WorkflowTraceCarrier = {
  baggage?: string;
  traceparent: string;
  tracestate?: string;
};

type WorkflowTracingEnvelope = {
  version: 1;
  carrier: WorkflowTraceCarrier;
};

type WorkflowTracingMetadata = {
  workflowTracing?: WorkflowTracingEnvelope;
};

type WorkflowTracingContextObject = JsonObject & {
  mistleTelemetry?: WorkflowTracingMetadata;
};

const WorkflowTracingVersion = 1;
const WorkflowTracingRootKey = "mistleTelemetry";
const WorkflowTracingFieldKey = "workflowTracing";
const WorkflowTracePropagator = new CompositePropagator({
  propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
});

function isJsonObject(input: unknown): input is JsonObject {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isWorkflowTraceCarrier(input: unknown): input is WorkflowTraceCarrier {
  if (!isJsonObject(input)) {
    return false;
  }

  const traceparent = input.traceparent;
  if (typeof traceparent !== "string" || traceparent.length === 0) {
    return false;
  }

  const tracestate = input.tracestate;
  if (tracestate !== undefined && typeof tracestate !== "string") {
    return false;
  }

  const baggage = input.baggage;
  if (baggage !== undefined && typeof baggage !== "string") {
    return false;
  }

  return true;
}

function isWorkflowTracingEnvelope(input: unknown): input is WorkflowTracingEnvelope {
  if (!isJsonObject(input)) {
    return false;
  }

  return input.version === WorkflowTracingVersion && isWorkflowTraceCarrier(input.carrier);
}

function cloneJsonObject(input: JsonObject): JsonObject {
  return { ...input };
}

function readWorkflowTracingContextObject(
  input: JsonValue | null,
): WorkflowTracingContextObject | null {
  if (input === null) {
    return null;
  }

  if (!isJsonObject(input)) {
    throw new Error("Expected workflow run context to be a JSON object or null.");
  }

  return input;
}

function readWorkflowTraceCarrier(input: JsonValue | null): WorkflowTraceCarrier | null {
  const workflowContext = readWorkflowTracingContextObject(input);
  if (workflowContext === null) {
    return null;
  }

  const telemetryValue = workflowContext[WorkflowTracingRootKey];
  if (telemetryValue === undefined) {
    return null;
  }
  if (!isJsonObject(telemetryValue)) {
    throw new Error(
      `Expected workflow run context field '${WorkflowTracingRootKey}' to be an object.`,
    );
  }

  const workflowTracing = telemetryValue[WorkflowTracingFieldKey];
  if (workflowTracing === undefined) {
    return null;
  }
  if (!isWorkflowTracingEnvelope(workflowTracing)) {
    throw new Error(
      `Expected workflow run context field '${WorkflowTracingRootKey}.${WorkflowTracingFieldKey}' to contain a valid workflow trace envelope.`,
    );
  }

  return workflowTracing.carrier;
}

function createActiveTraceCarrier(): WorkflowTraceCarrier | null {
  const spanContext = readSpanContext(context.active());
  if (spanContext === undefined || !trace.isSpanContextValid(spanContext)) {
    return null;
  }

  const carrier: Record<string, string> = {};
  WorkflowTracePropagator.inject(context.active(), carrier, defaultTextMapSetter);

  const traceparent = carrier.traceparent;
  if (typeof traceparent !== "string" || traceparent.length === 0) {
    return null;
  }

  const workflowTraceCarrier: WorkflowTraceCarrier = {
    traceparent,
  };

  if (typeof carrier.tracestate === "string" && carrier.tracestate.length > 0) {
    workflowTraceCarrier.tracestate = carrier.tracestate;
  }
  if (typeof carrier.baggage === "string" && carrier.baggage.length > 0) {
    workflowTraceCarrier.baggage = carrier.baggage;
  }

  return workflowTraceCarrier;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}

function normalizeRecordedException(error: unknown): Error | string {
  if (error instanceof Error || typeof error === "string") {
    return error;
  }

  return new Error(normalizeErrorMessage(error));
}

function readSpanContext(activeContext: Context) {
  const directSpanContext = trace.getSpanContext(activeContext);
  if (directSpanContext !== undefined) {
    return directSpanContext;
  }

  return trace.getSpan(activeContext)?.spanContext();
}

function hasValidActiveSpanContext(activeContext: Context): boolean {
  const spanContext = readSpanContext(activeContext);
  return spanContext !== undefined && trace.isSpanContextValid(spanContext);
}

export function injectActiveTraceContextIntoWorkflowRunContext(
  input: JsonValue | null,
): JsonValue | null {
  const carrier = createActiveTraceCarrier();
  if (carrier === null) {
    return input;
  }

  const workflowContext = readWorkflowTracingContextObject(input);
  const nextWorkflowContext = workflowContext === null ? {} : cloneJsonObject(workflowContext);
  const existingTelemetryValue = nextWorkflowContext[WorkflowTracingRootKey];

  let nextTelemetryValue: JsonObject;
  if (existingTelemetryValue === undefined) {
    nextTelemetryValue = {};
  } else {
    if (!isJsonObject(existingTelemetryValue)) {
      throw new Error(
        `Expected workflow run context field '${WorkflowTracingRootKey}' to be an object when trace propagation is enabled.`,
      );
    }

    nextTelemetryValue = cloneJsonObject(existingTelemetryValue);
  }

  nextTelemetryValue[WorkflowTracingFieldKey] = {
    version: WorkflowTracingVersion,
    carrier,
  };
  nextWorkflowContext[WorkflowTracingRootKey] = nextTelemetryValue;

  return nextWorkflowContext;
}

export function extractTraceContextFromWorkflowRunContext(input: JsonValue | null): Context | null {
  const carrier = readWorkflowTraceCarrier(input);
  if (carrier === null) {
    return null;
  }

  return WorkflowTracePropagator.extract(context.active(), carrier, defaultTextMapGetter);
}

export function runWithWorkflowTraceContext<Output>(input: {
  fn: () => Promise<Output> | Output;
  serviceName: string;
  spanName: string;
  workflowRunContext: JsonValue | null;
  workflowRunId: string;
  workflowVersion: string | null;
}): Promise<Output> {
  const parentContext =
    extractTraceContextFromWorkflowRunContext(input.workflowRunContext) ?? context.active();
  const tracer = trace.getTracer(input.serviceName);

  return tracer.startActiveSpan(
    input.spanName,
    {
      attributes: {
        "mistle.workflow.run.id": input.workflowRunId,
        ...(input.workflowVersion === null
          ? {}
          : {
              "mistle.workflow.version": input.workflowVersion,
            }),
      },
    },
    parentContext,
    async (span) => {
      if (!span.isRecording() && hasValidActiveSpanContext(parentContext)) {
        span.end();
        return context.with(parentContext, async () => input.fn());
      }

      try {
        return await input.fn();
      } catch (error) {
        const message = normalizeErrorMessage(error);
        span.recordException(normalizeRecordedException(error));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message,
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
