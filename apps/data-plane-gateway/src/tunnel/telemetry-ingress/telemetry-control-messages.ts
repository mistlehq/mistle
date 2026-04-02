import type {
  TelemetryOpenError,
  TelemetryOpenOK,
  TelemetryReset,
  TelemetryWindow,
} from "@mistle/sandbox-session-protocol";

export function createTelemetryOpenOk(input: {
  initialWindowBytes: number;
  streamId: number;
}): TelemetryOpenOK {
  return {
    type: "telemetry.open.ok",
    streamId: input.streamId,
    initialWindowBytes: input.initialWindowBytes,
  };
}

export function createTelemetryOpenError(input: {
  code: string;
  message: string;
  streamId: number;
}): TelemetryOpenError {
  return {
    type: "telemetry.open.error",
    streamId: input.streamId,
    code: input.code,
    message: input.message,
  };
}

export function createTelemetryReset(input: {
  code: string;
  message: string;
  streamId: number;
}): TelemetryReset {
  return {
    type: "telemetry.reset",
    streamId: input.streamId,
    code: input.code,
    message: input.message,
  };
}

export function createTelemetryWindow(input: { bytes: number; streamId: number }): TelemetryWindow {
  return {
    type: "telemetry.window",
    streamId: input.streamId,
    bytes: input.bytes,
  };
}
