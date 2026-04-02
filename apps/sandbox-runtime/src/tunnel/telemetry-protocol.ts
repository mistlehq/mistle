import {
  parseTelemetryControlMessage,
  type TelemetryControlMessage,
} from "@mistle/sandbox-session-protocol";

export type BootstrapTelemetryControlMessage = Extract<
  TelemetryControlMessage,
  {
    type: "telemetry.open.ok" | "telemetry.open.error" | "telemetry.window" | "telemetry.reset";
  }
>;

export function parseBootstrapTelemetryControlMessage(
  payload: string,
): BootstrapTelemetryControlMessage | undefined {
  const message = parseTelemetryControlMessage(payload);
  if (
    message?.type !== "telemetry.open.ok" &&
    message?.type !== "telemetry.open.error" &&
    message?.type !== "telemetry.window" &&
    message?.type !== "telemetry.reset"
  ) {
    return undefined;
  }

  return message;
}
