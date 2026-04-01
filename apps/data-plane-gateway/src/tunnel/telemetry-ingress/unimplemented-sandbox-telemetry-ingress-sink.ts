import type {
  SandboxTelemetryIngressSink,
  SandboxTelemetryIngressStream,
} from "./sandbox-telemetry-ingress-sink.js";

const UnimplementedTelemetrySinkMessage =
  "Sandbox telemetry sink is not configured on this gateway.";

export class UnimplementedSandboxTelemetryIngressSink implements SandboxTelemetryIngressSink {
  public async openStream(_input: SandboxTelemetryIngressStream): Promise<void> {
    throw new Error(UnimplementedTelemetrySinkMessage);
  }

  public async append(
    _input: SandboxTelemetryIngressStream & { payload: Uint8Array },
  ): Promise<void> {
    throw new Error(UnimplementedTelemetrySinkMessage);
  }

  public async closeStream(_input: SandboxTelemetryIngressStream): Promise<void> {
    throw new Error(UnimplementedTelemetrySinkMessage);
  }
}
