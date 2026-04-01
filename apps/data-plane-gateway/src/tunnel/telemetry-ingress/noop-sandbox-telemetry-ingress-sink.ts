import type {
  SandboxTelemetryIngressSink,
  SandboxTelemetryIngressStream,
} from "./sandbox-telemetry-ingress-sink.js";

export class NoopSandboxTelemetryIngressSink implements SandboxTelemetryIngressSink {
  public async openStream(_input: SandboxTelemetryIngressStream): Promise<void> {
    return;
  }

  public async append(
    _input: SandboxTelemetryIngressStream & { payload: Uint8Array },
  ): Promise<void> {
    return;
  }

  public async closeStream(_input: SandboxTelemetryIngressStream): Promise<void> {
    return;
  }

  public async shutdown(): Promise<void> {
    return;
  }
}
