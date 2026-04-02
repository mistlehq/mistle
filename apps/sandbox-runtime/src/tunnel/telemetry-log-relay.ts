import {
  MaxStreamWindowBytes,
  PayloadKindRawBytes,
  type TelemetryClose,
  type TelemetryOpen,
  type TelemetryOpenError,
  type TelemetryOpenOK,
  type TelemetryReset,
  type TelemetryWindow,
} from "@mistle/sandbox-session-protocol";
import type WebSocket from "ws";

import {
  addLogLineListener,
  formatSandboxRuntimeLogLine,
  type SandboxRuntimeLogLevel,
} from "../runtime/logger.js";
import { writeBinaryDataFrame } from "./messages.js";
import { TelemetryLogBuffer } from "./telemetry-log-buffer.js";
import { sendWebSocketMessage } from "./websocket.js";

export const SandboxTelemetryLogStreamId = 0xffff_fffe;
const TelemetryLogsSignal = "logs";
const TelemetryLogsFormat = "mistle.sandbox-runtime.log.v1";

type BootstrapTelemetryRelayControlMessage =
  | TelemetryOpenOK
  | TelemetryOpenError
  | TelemetryWindow
  | TelemetryReset;

type TelemetryRelayState = "disconnected" | "opening" | "open" | "disabled";

function writeTelemetryRelayDiagnostic(input: {
  level: SandboxRuntimeLogLevel;
  event: string;
  fields?: Record<string, string | number | boolean | null>;
}): void {
  process.stderr.write(
    formatSandboxRuntimeLogLine({
      timestamp: new Date(),
      level: input.level,
      event: input.event,
      ...(input.fields === undefined ? {} : { fields: input.fields }),
    }),
  );
}

export class TelemetryLogRelay {
  readonly #encoder = new TextEncoder();
  readonly #buffer: TelemetryLogBuffer;
  #flushPromise: Promise<void> | undefined;
  #removeLogLineListener: (() => void) | undefined;
  #state: TelemetryRelayState = "disconnected";
  #tunnelSocket: WebSocket | undefined;

  public constructor(maxBufferedBytes: number = MaxStreamWindowBytes) {
    this.#buffer = new TelemetryLogBuffer(maxBufferedBytes);
  }

  public attachTunnelConnection(tunnelSocket: WebSocket): void {
    this.#tunnelSocket = tunnelSocket;
    this.#buffer.clear();
    this.#state = "opening";
    this.#removeLogLineListener?.();
    this.#removeLogLineListener = addLogLineListener((line) => {
      this.enqueueLogLine(line);
    });

    const telemetryOpen: TelemetryOpen = {
      type: "telemetry.open",
      streamId: SandboxTelemetryLogStreamId,
      signal: TelemetryLogsSignal,
      format: TelemetryLogsFormat,
    };

    void sendWebSocketMessage(tunnelSocket, {
      kind: "text",
      payload: JSON.stringify(telemetryOpen),
    }).catch((error: unknown) => {
      this.#disableRelay(
        "sandbox_tunnel_telemetry_open_send_failed",
        error instanceof Error ? error.message : String(error),
      );
    });
  }

  public detachTunnelConnection(tunnelSocket: WebSocket): void {
    if (this.#tunnelSocket !== tunnelSocket) {
      return;
    }

    this.#removeLogLineListener?.();
    this.#removeLogLineListener = undefined;
    const shouldSendClose = this.#state === "opening" || this.#state === "open";
    this.#tunnelSocket = undefined;
    this.#state = "disconnected";
    this.#buffer.clear();

    if (!shouldSendClose) {
      return;
    }

    const telemetryClose: TelemetryClose = {
      type: "telemetry.close",
      streamId: SandboxTelemetryLogStreamId,
    };
    void sendWebSocketMessage(tunnelSocket, {
      kind: "text",
      payload: JSON.stringify(telemetryClose),
    }).catch(() => undefined);
  }

  public handleControlMessage(message: BootstrapTelemetryRelayControlMessage): boolean {
    if (message.streamId !== SandboxTelemetryLogStreamId) {
      return false;
    }

    switch (message.type) {
      case "telemetry.open.ok":
        this.#buffer.resetWindow(message.initialWindowBytes);
        this.#state = "open";
        this.#scheduleFlush();
        return true;
      case "telemetry.window":
        if (this.#state !== "open") {
          return true;
        }
        try {
          this.#buffer.addWindow(message.bytes);
        } catch (error) {
          this.#disableRelay(
            "sandbox_tunnel_telemetry_window_invalid",
            error instanceof Error ? error.message : String(error),
          );
          return true;
        }
        this.#scheduleFlush();
        return true;
      case "telemetry.open.error":
        this.#disableRelay("sandbox_tunnel_telemetry_open_failed", message.message);
        return true;
      case "telemetry.reset":
        this.#disableRelay("sandbox_tunnel_telemetry_stream_reset", message.message);
        return true;
    }
  }

  public enqueueLogLine(line: string): void {
    if (this.#state === "disconnected" || this.#state === "disabled") {
      return;
    }

    const encodedLine = this.#encoder.encode(line);
    const enqueueResult = this.#buffer.enqueue(encodedLine);
    if (enqueueResult.kind === "dropped") {
      if (enqueueResult.emitWarning) {
        this.#emitDropWarning(enqueueResult.droppedBytes);
      }
      return;
    }
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#flushPromise !== undefined) {
      return;
    }

    this.#flushPromise = this.#flushBufferedLines().finally(() => {
      this.#flushPromise = undefined;
      if (
        this.#state === "open" &&
        this.#tunnelSocket !== undefined &&
        this.#buffer.bufferedLineCount > 0
      ) {
        this.#scheduleFlush();
      }
    });
  }

  async #flushBufferedLines(): Promise<void> {
    const tunnelSocket = this.#tunnelSocket;
    if (this.#state !== "open" || tunnelSocket === undefined) {
      return;
    }

    for (const nextLine of this.#buffer.drainSendableLines()) {
      try {
        await writeBinaryDataFrame(tunnelSocket, {
          streamId: SandboxTelemetryLogStreamId,
          payloadKind: PayloadKindRawBytes,
          payload: nextLine,
        });
      } catch (error) {
        this.#disableRelay(
          "sandbox_tunnel_telemetry_send_failed",
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
    }
  }

  #emitDropWarning(droppedBytes: number): void {
    writeTelemetryRelayDiagnostic({
      level: "warn",
      event: "sandbox_tunnel_telemetry_log_dropped",
      fields: {
        droppedBytes,
      },
    });
  }

  #disableRelay(event: string, message: string): void {
    this.#state = "disabled";
    this.#tunnelSocket = undefined;
    this.#buffer.clear();
    writeTelemetryRelayDiagnostic({
      level: "warn",
      event,
      fields: {
        message,
      },
    });
  }
}
