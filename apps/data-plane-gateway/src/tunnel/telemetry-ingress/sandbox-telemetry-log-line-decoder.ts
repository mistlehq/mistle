import { SandboxTelemetryResetError } from "./errors.js";

const LineDelimiterByte = 0x0a;
const MaxTelemetryLineBytes = 16 * 1024 * 1024;

function concatenateBytes(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }

  return combined;
}

function decodeUtf8Line(lineBytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(lineBytes);
  } catch {
    throw new SandboxTelemetryResetError({
      code: "invalid_telemetry_log_shape",
      message: "Telemetry log line does not match mistle.sandbox-runtime.log.v1.",
    });
  }
}

function ensureLineByteLength(lineBytes: Uint8Array): void {
  if (lineBytes.byteLength <= MaxTelemetryLineBytes) {
    return;
  }

  throw new SandboxTelemetryResetError({
    code: "invalid_telemetry_log_shape",
    message: "Telemetry log line does not match mistle.sandbox-runtime.log.v1.",
  });
}

export class SandboxTelemetryLogLineDecoder {
  #pendingBytes = new Uint8Array(0);

  public append(payload: Uint8Array): string[] {
    if (payload.byteLength === 0) {
      return [];
    }

    const combined = concatenateBytes([this.#pendingBytes, payload]);
    const completedLines: string[] = [];
    let lineStartIndex = 0;

    for (let byteIndex = 0; byteIndex < combined.byteLength; byteIndex += 1) {
      if (combined[byteIndex] !== LineDelimiterByte) {
        continue;
      }

      const lineBytes = combined.subarray(lineStartIndex, byteIndex);
      lineStartIndex = byteIndex + 1;

      if (lineBytes.byteLength === 0) {
        continue;
      }

      ensureLineByteLength(lineBytes);
      completedLines.push(decodeUtf8Line(lineBytes));
    }

    this.#pendingBytes = combined.slice(lineStartIndex);
    return completedLines;
  }

  public finalize(): void {
    if (this.#pendingBytes.byteLength === 0) {
      return;
    }

    this.#pendingBytes = new Uint8Array(0);
    throw new SandboxTelemetryResetError({
      code: "unterminated_telemetry_line",
      message: "Telemetry stream closed with an incomplete log line.",
    });
  }
}
