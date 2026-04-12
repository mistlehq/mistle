import { createOtlpLogForwarder, type OtlpLogForwarder } from "@mistle/telemetry";
import type { Clock } from "@mistle/time";

import type { DataPlaneGatewayGlobalConfig } from "../../types.js";
import { NoopSandboxTelemetryIngressSink } from "./noop-sandbox-telemetry-ingress-sink.js";
import type {
  SandboxTelemetryIngressSink,
  SandboxTelemetryIngressStream,
} from "./sandbox-telemetry-ingress-sink.js";
import { SandboxTelemetryLogLineDecoder } from "./sandbox-telemetry-log-line-decoder.js";
import {
  parseSandboxTelemetryLogLine,
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
