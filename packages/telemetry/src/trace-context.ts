import { context, defaultTextMapSetter, trace, type Context } from "@opentelemetry/api";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";

export type W3cTraceCarrier = {
  traceparent: string;
  tracestate?: string;
  baggage?: string;
};

const W3cTracePropagator = new CompositePropagator({
  propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
});

function readActiveSpanContext(activeContext: Context) {
  return trace.getSpanContext(activeContext) ?? trace.getSpan(activeContext)?.spanContext();
}

export function extractW3cTraceCarrier(activeContext: Context): W3cTraceCarrier | null {
  const activeSpanContext = readActiveSpanContext(activeContext);
  if (activeSpanContext === undefined || !trace.isSpanContextValid(activeSpanContext)) {
    return null;
  }

  const carrier: Record<string, string> = {};
  W3cTracePropagator.inject(activeContext, carrier, defaultTextMapSetter);

  const traceparent = carrier.traceparent;
  if (typeof traceparent !== "string" || traceparent.length === 0) {
    return null;
  }

  return {
    traceparent,
    ...(typeof carrier.tracestate === "string" && carrier.tracestate.length > 0
      ? { tracestate: carrier.tracestate }
      : {}),
    ...(typeof carrier.baggage === "string" && carrier.baggage.length > 0
      ? { baggage: carrier.baggage }
      : {}),
  };
}

export function extractActiveW3cTraceCarrier(): W3cTraceCarrier | null {
  return extractW3cTraceCarrier(context.active());
}
