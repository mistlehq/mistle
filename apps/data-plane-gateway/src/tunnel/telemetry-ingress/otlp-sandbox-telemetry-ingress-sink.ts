import { createOtlpLogForwarder, type OtlpLogForwarder } from "@mistle/telemetry";
import type { Clock } from "@mistle/time";
import { metrics, type Attributes } from "@opentelemetry/api";

import type { DataPlaneGatewayGlobalConfig } from "../../types.js";
import { NoopSandboxTelemetryIngressSink } from "./noop-sandbox-telemetry-ingress-sink.js";
import type {
  SandboxTelemetryIngressSink,
  SandboxTelemetryIngressStream,
} from "./sandbox-telemetry-ingress-sink.js";
import { SandboxTelemetryLogLineDecoder } from "./sandbox-telemetry-log-line-decoder.js";
import {
  parseSandboxTelemetryLogLine,
  toSandboxTunnelMetricObservation,
  toSandboxTelemetryLogRecord,
} from "./sandbox-telemetry-log-line.js";
import { getTelemetryContentType } from "./telemetry-stream-format.js";

type ActiveOtlpSandboxTelemetryLogStream = SandboxTelemetryIngressStream & {
  lineDecoder: SandboxTelemetryLogLineDecoder;
};

type ActiveOtlpSandboxTelemetryTraceStream = SandboxTelemetryIngressStream & {
  contentType: string;
};

type ActiveOtlpSandboxTelemetryStream =
  | ActiveOtlpSandboxTelemetryLogStream
  | ActiveOtlpSandboxTelemetryTraceStream;

type OtlpTraceForwarder = {
  forward: (input: { contentType: string; payload: Uint8Array }) => Promise<void>;
};

type EnabledTelemetryTracesConfig = Extract<
  DataPlaneGatewayGlobalConfig["telemetry"],
  { enabled: true }
>["traces"];

const TunnelTelemetryMeter = metrics.getMeter("@mistle/data-plane-gateway/tunnel");

class SandboxTunnelMetricsRecorder {
  readonly #streamDurationMs = TunnelTelemetryMeter.createHistogram(
    "mistle.sandbox.tunnel.stream.duration",
    {
      description: "Observed lifetime of bootstrap-tunnel streams.",
      unit: "ms",
    },
  );

  readonly #streamTotalBytes = TunnelTelemetryMeter.createHistogram(
    "mistle.sandbox.tunnel.stream.total_bytes",
    {
      description: "Total bytes observed per stream summary, split by direction.",
      unit: "By",
    },
  );

  readonly #streamMaxMessageBytes = TunnelTelemetryMeter.createHistogram(
    "mistle.sandbox.tunnel.stream.max_message_bytes",
    {
      description: "Largest single message observed on a stream summary, split by direction.",
      unit: "By",
    },
  );

  readonly #streamMaxOutstandingBytes = TunnelTelemetryMeter.createHistogram(
    "mistle.sandbox.tunnel.stream.max_outstanding_bytes",
    {
      description: "Maximum unacknowledged bytes observed on a stream before it closed.",
      unit: "By",
    },
  );

  readonly #streamAvgCreditReturnMs = TunnelTelemetryMeter.createHistogram(
    "mistle.sandbox.tunnel.stream.avg_credit_return",
    {
      description: "Average stream.window credit return latency observed per stream summary.",
      unit: "ms",
    },
  );

  readonly #streamResetCount = TunnelTelemetryMeter.createCounter(
    "mistle.sandbox.tunnel.stream.reset.count",
    {
      description: "Count of stream summaries that ended in a reset.",
    },
  );

  readonly #streamWindowExhaustedCount = TunnelTelemetryMeter.createCounter(
    "mistle.sandbox.tunnel.stream.window_exhausted.count",
    {
      description: "Count of stream_window_exhausted events emitted by sandboxd.",
    },
  );

  readonly #streamWindowExhaustedPayloadBytes = TunnelTelemetryMeter.createHistogram(
    "mistle.sandbox.tunnel.stream.window_exhausted.payload_bytes",
    {
      description: "Payload size that triggered a stream_window_exhausted reset.",
      unit: "By",
    },
  );

  readonly #streamWindowExhaustedOutstandingBytes = TunnelTelemetryMeter.createHistogram(
    "mistle.sandbox.tunnel.stream.window_exhausted.outstanding_bytes",
    {
      description: "Outstanding unacknowledged bytes present when stream_window_exhausted fired.",
      unit: "By",
    },
  );

  public recordFromLogLine(logLine: ReturnType<typeof parseSandboxTelemetryLogLine>): void {
    const observation = toSandboxTunnelMetricObservation(logLine);
    if (observation === undefined) {
      return;
    }

    if (observation.kind === "agent_stream_summary") {
      const summaryAttributes = this.#buildSummaryAttributes({
        channelKind: observation.channelKind,
        outcome: observation.outcome,
        resetCode: observation.resetCode,
      });
      this.#streamDurationMs.record(observation.durationMs, summaryAttributes);
      this.#streamTotalBytes.record(
        observation.totalBytesOut,
        this.#withDirection(summaryAttributes, "outbound"),
      );
      this.#streamTotalBytes.record(
        observation.totalBytesIn,
        this.#withDirection(summaryAttributes, "inbound"),
      );
      this.#streamMaxMessageBytes.record(
        observation.maxMessageBytesOut,
        this.#withDirection(summaryAttributes, "outbound"),
      );
      this.#streamMaxMessageBytes.record(
        observation.maxMessageBytesIn,
        this.#withDirection(summaryAttributes, "inbound"),
      );
      this.#streamMaxOutstandingBytes.record(observation.maxOutstandingBytes, summaryAttributes);
      if (observation.avgCreditReturnMs !== null) {
        this.#streamAvgCreditReturnMs.record(observation.avgCreditReturnMs, summaryAttributes);
      }
      if (observation.resetCode !== null) {
        this.#streamResetCount.add(1, summaryAttributes);
      }
      return;
    }

    const exhaustionAttributes = {
      "mistle.channel_kind": observation.channelKind,
      "mistle.payload_kind": observation.payloadKind,
    } satisfies Attributes;
    this.#streamWindowExhaustedCount.add(1, exhaustionAttributes);
    this.#streamWindowExhaustedPayloadBytes.record(observation.payloadBytes, exhaustionAttributes);
    this.#streamWindowExhaustedOutstandingBytes.record(
      observation.outstandingBytes,
      exhaustionAttributes,
    );
  }

  #buildSummaryAttributes(input: {
    channelKind: string;
    outcome: string;
    resetCode: string | null;
  }): Attributes {
    const attributes: Record<string, string> = {
      "mistle.channel_kind": input.channelKind,
      "mistle.outcome": input.outcome,
    };
    if (input.resetCode !== null) {
      attributes["mistle.reset_code"] = input.resetCode;
    }
    return attributes;
  }

  #withDirection(attributes: Attributes, direction: "inbound" | "outbound"): Attributes {
    return {
      ...attributes,
      "mistle.direction": direction,
    };
  }
}

function buildStreamKey(input: {
  relaySessionId: string;
  sandboxInstanceId: string;
  streamId: number;
}): string {
  return `${input.sandboxInstanceId}:${input.relaySessionId}:${String(input.streamId)}`;
}

function joinResourceAttributes(
  resourceAttributes: string | undefined,
  extraAttribute: string,
): string {
  return resourceAttributes === undefined
    ? extraAttribute
    : `${resourceAttributes},${extraAttribute}`;
}

function isLogStream(
  input: ActiveOtlpSandboxTelemetryStream,
): input is ActiveOtlpSandboxTelemetryLogStream {
  return input.signal === "logs";
}

function createOtlpTraceForwarder(input: {
  traces: EnabledTelemetryTracesConfig;
}): OtlpTraceForwarder {
  return {
    forward: async ({ contentType, payload }) => {
      const response = await fetch(input.traces.endpoint, {
        method: "POST",
        headers: {
          "content-type": contentType,
        },
        body: Buffer.from(payload),
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        throw new Error(
          `Trace OTLP export failed with status ${String(response.status)}${responseBody.length > 0 ? `: ${responseBody}` : "."}`,
        );
      }
    },
  };
}

export class OtlpSandboxTelemetryIngressSink implements SandboxTelemetryIngressSink {
  readonly #streams = new Map<string, ActiveOtlpSandboxTelemetryStream>();
  readonly #metricsRecorder = new SandboxTunnelMetricsRecorder();

  public constructor(
    private readonly input: {
      clock: Clock;
      gatewayNodeId: string;
      logForwarder: OtlpLogForwarder;
      traceForwarder: OtlpTraceForwarder;
    },
  ) {}

  public async openStream(input: SandboxTelemetryIngressStream): Promise<void> {
    const streamKey = buildStreamKey(input);
    if (this.#streams.has(streamKey)) {
      throw new Error(`Sandbox telemetry stream ${String(input.streamId)} is already open.`);
    }

    if (input.signal === "logs") {
      this.#streams.set(streamKey, {
        ...input,
        lineDecoder: new SandboxTelemetryLogLineDecoder(),
      });
      return;
    }

    const contentType = getTelemetryContentType(input);
    if (contentType === undefined) {
      throw new Error(
        `Unsupported sandbox telemetry stream format '${input.format}' for signal '${input.signal}'.`,
      );
    }

    this.#streams.set(streamKey, {
      ...input,
      contentType,
    });
  }

  public async append(
    input: SandboxTelemetryIngressStream & { payload: Uint8Array },
  ): Promise<void> {
    const activeStream = this.#streams.get(buildStreamKey(input));
    if (activeStream === undefined) {
      throw new Error(`Sandbox telemetry stream ${String(input.streamId)} is not open.`);
    }

    if (isLogStream(activeStream)) {
      const completedLines = activeStream.lineDecoder.append(input.payload);
      for (const line of completedLines) {
        const parsedLine = parseSandboxTelemetryLogLine(line);
        this.#metricsRecorder.recordFromLogLine(parsedLine);
        this.input.logForwarder.emit(
          toSandboxTelemetryLogRecord({
            clock: this.input.clock,
            gatewayNodeId: this.input.gatewayNodeId,
            relaySessionId: input.relaySessionId,
            sandboxInstanceId: input.sandboxInstanceId,
            logLine: parsedLine,
          }),
        );
      }
      return;
    }

    await this.input.traceForwarder.forward({
      contentType: activeStream.contentType,
      payload: input.payload,
    });
  }

  public async closeStream(input: SandboxTelemetryIngressStream): Promise<void> {
    const streamKey = buildStreamKey(input);
    const activeStream = this.#streams.get(streamKey);
    if (activeStream === undefined) {
      return;
    }

    this.#streams.delete(streamKey);
    if (isLogStream(activeStream)) {
      activeStream.lineDecoder.finalize();
    }
  }

  public async shutdown(): Promise<void> {
    this.#streams.clear();
    await this.input.logForwarder.shutdown();
  }
}

export function createSandboxTelemetryIngressSink(input: {
  clock: Clock;
  gatewayNodeId: string;
  telemetry: DataPlaneGatewayGlobalConfig["telemetry"];
}): SandboxTelemetryIngressSink {
  if (!input.telemetry.enabled) {
    return new NoopSandboxTelemetryIngressSink();
  }

  return new OtlpSandboxTelemetryIngressSink({
    clock: input.clock,
    gatewayNodeId: input.gatewayNodeId,
    logForwarder: createOtlpLogForwarder({
      serviceName: "@mistle/sandboxd",
      resourceAttributes: joinResourceAttributes(
        input.telemetry.resourceAttributes,
        "mistle.telemetry.ingest=gateway-tunnel",
      ),
      logs: input.telemetry.logs,
    }),
    traceForwarder: createOtlpTraceForwarder({
      traces: input.telemetry.traces,
    }),
  });
}
