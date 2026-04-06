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

type ActiveOtlpSandboxTelemetryStream = SandboxTelemetryIngressStream & {
  lineDecoder: SandboxTelemetryLogLineDecoder;
};

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

export class OtlpSandboxTelemetryIngressSink implements SandboxTelemetryIngressSink {
  readonly #streams = new Map<string, ActiveOtlpSandboxTelemetryStream>();

  public constructor(
    private readonly input: {
      clock: Clock;
      gatewayNodeId: string;
      logForwarder: OtlpLogForwarder;
    },
  ) {}

  public async openStream(input: SandboxTelemetryIngressStream): Promise<void> {
    const streamKey = buildStreamKey(input);
    if (this.#streams.has(streamKey)) {
      throw new Error(`Sandbox telemetry stream ${String(input.streamId)} is already open.`);
    }

    this.#streams.set(streamKey, {
      ...input,
      lineDecoder: new SandboxTelemetryLogLineDecoder(),
    });
  }

  public async append(
    input: SandboxTelemetryIngressStream & { payload: Uint8Array },
  ): Promise<void> {
    const activeStream = this.#streams.get(buildStreamKey(input));
    if (activeStream === undefined) {
      throw new Error(`Sandbox telemetry stream ${String(input.streamId)} is not open.`);
    }

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
  }

  public async closeStream(input: SandboxTelemetryIngressStream): Promise<void> {
    const streamKey = buildStreamKey(input);
    const activeStream = this.#streams.get(streamKey);
    if (activeStream === undefined) {
      return;
    }

    this.#streams.delete(streamKey);
    activeStream.lineDecoder.finalize();
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
  });
}
