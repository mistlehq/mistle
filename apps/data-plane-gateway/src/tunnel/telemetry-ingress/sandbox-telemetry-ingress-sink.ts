import type { TelemetryFormat, TelemetrySignal } from "@mistle/sandbox-session-protocol";

export type SandboxTelemetryIngressStream = {
  format: TelemetryFormat;
  relaySessionId: string;
  sandboxInstanceId: string;
  signal: TelemetrySignal;
  streamId: number;
};

export interface SandboxTelemetryIngressSink {
  openStream(input: SandboxTelemetryIngressStream): Promise<void>;
  append(input: SandboxTelemetryIngressStream & { payload: Uint8Array }): Promise<void>;
  closeStream(input: SandboxTelemetryIngressStream): Promise<void>;
  shutdown(): Promise<void>;
}
