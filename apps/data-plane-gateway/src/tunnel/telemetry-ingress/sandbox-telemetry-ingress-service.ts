import {
  decodeDataFrame,
  type TelemetryOpenError,
  type TelemetryOpenOK,
  type TelemetryReset,
  type TelemetryWindow,
} from "@mistle/sandbox-session-protocol";

import { logger } from "../../logger.js";
import type { TelemetryDelivery } from "../tunnel-websocket-message-handler.js";
import {
  BootstrapTelemetrySession,
  type ActiveBootstrapTelemetryStream,
} from "./bootstrap-telemetry-session.js";
import { SandboxTelemetryResetError } from "./errors.js";
import type {
  SandboxTelemetryIngressSink,
  SandboxTelemetryIngressStream,
} from "./sandbox-telemetry-ingress-sink.js";
import { createTelemetryOpenError, createTelemetryReset } from "./telemetry-control-messages.js";

type TelemetryControlMessage =
  | TelemetryOpenOK
  | TelemetryOpenError
  | TelemetryReset
  | TelemetryWindow;

const TelemetrySinkFailureMessage = "Gateway failed to ingest telemetry bytes.";

function toSessionKey(input: { relaySessionId: string; sandboxInstanceId: string }): string {
  return `${input.sandboxInstanceId}:${input.relaySessionId}`;
}

function toIngressStream(input: {
  relaySessionId: string;
  sandboxInstanceId: string;
  stream: ActiveBootstrapTelemetryStream;
}): SandboxTelemetryIngressStream {
  return {
    format: input.stream.format,
    relaySessionId: input.relaySessionId,
    sandboxInstanceId: input.sandboxInstanceId,
    signal: input.stream.signal,
    streamId: input.stream.streamId,
  };
}

export class SandboxTelemetryIngressService {
  readonly #sessions = new Map<string, BootstrapTelemetrySession>();

  public constructor(private readonly sink: SandboxTelemetryIngressSink) {}

  public async handleDelivery(input: {
    delivery: TelemetryDelivery;
    relaySessionId: string;
    sandboxInstanceId: string;
    sendControlMessage: (message: TelemetryControlMessage) => void;
  }): Promise<void> {
    if (input.delivery.kind === "telemetryOpen") {
      await this.handleOpen({
        delivery: input.delivery,
        relaySessionId: input.relaySessionId,
        sandboxInstanceId: input.sandboxInstanceId,
        sendControlMessage: input.sendControlMessage,
      });
      return;
    }

    const sessionKey = toSessionKey(input);
    const session = this.#sessions.get(sessionKey);
    if (session === undefined) {
      if (input.delivery.kind === "telemetryClose") {
        return;
      }

      input.sendControlMessage(
        createTelemetryReset({
          code: "telemetry_stream_not_found",
          message: `Telemetry stream ${String(input.delivery.streamId)} is not open on this bootstrap session.`,
          streamId: input.delivery.streamId,
        }),
      );
      return;
    }

    if (input.delivery.kind === "telemetryData") {
      await this.handleData({
        delivery: input.delivery,
        relaySessionId: input.relaySessionId,
        sandboxInstanceId: input.sandboxInstanceId,
        sendControlMessage: input.sendControlMessage,
        session,
        sessionKey,
      });
      return;
    }

    if (input.delivery.kind === "telemetryInvalidData") {
      const invalidation = session.invalidateStream({
        payloadKind: input.delivery.payloadKind,
        streamId: input.delivery.streamId,
      });
      input.sendControlMessage(invalidation.response);
      if (invalidation.stream !== undefined) {
        await this.closeSinkStream({
          relaySessionId: input.relaySessionId,
          sandboxInstanceId: input.sandboxInstanceId,
          stream: invalidation.stream,
        }).catch(() => {
          // Preserve the original invalid-data reset reason for the peer.
        });
      }
      this.deleteSessionIfEmpty(sessionKey, session);
      return;
    }

    const stream = session.closeStream(input.delivery.message.streamId);
    if (stream === undefined) {
      this.deleteSessionIfEmpty(sessionKey, session);
      return;
    }

    try {
      await this.closeSinkStream({
        relaySessionId: input.relaySessionId,
        sandboxInstanceId: input.sandboxInstanceId,
        stream,
      });
    } catch (error) {
      input.sendControlMessage(
        this.toTelemetryReset({
          error,
          streamId: stream.streamId,
        }),
      );
    }
    this.deleteSessionIfEmpty(sessionKey, session);
  }

  public async detachBootstrapSession(input: {
    relaySessionId: string;
    sandboxInstanceId: string;
  }): Promise<void> {
    const sessionKey = toSessionKey(input);
    const session = this.#sessions.get(sessionKey);
    if (session === undefined) {
      return;
    }

    this.#sessions.delete(sessionKey);
    const streams = session.closeAllStreams();
    await Promise.all(
      streams.map(async (stream) =>
        this.closeSinkStream({
          relaySessionId: input.relaySessionId,
          sandboxInstanceId: input.sandboxInstanceId,
          stream,
        }).catch((error: unknown) => {
          logger.warn(
            {
              err: error,
              relaySessionId: input.relaySessionId,
              sandboxInstanceId: input.sandboxInstanceId,
              signal: stream.signal,
              streamId: stream.streamId,
            },
            "Failed closing sandbox telemetry ingress stream during detach",
          );
        }),
      ),
    );
  }

  public async shutdown(): Promise<void> {
    this.#sessions.clear();
    await this.sink.shutdown();
  }

  private async handleOpen(input: {
    delivery: Extract<TelemetryDelivery, { kind: "telemetryOpen" }>;
    relaySessionId: string;
    sandboxInstanceId: string;
    sendControlMessage: (message: TelemetryControlMessage) => void;
  }): Promise<void> {
    const sessionKey = toSessionKey(input);
    const session = this.#sessions.get(sessionKey) ?? new BootstrapTelemetrySession();
    const openResult = session.openStream({
      format: input.delivery.message.format,
      signal: input.delivery.message.signal,
      streamId: input.delivery.message.streamId,
    });
    if (openResult.kind === "error") {
      input.sendControlMessage(openResult.response);
      this.deleteSessionIfEmpty(sessionKey, session);
      return;
    }

    try {
      await this.sink.openStream(
        toIngressStream({
          relaySessionId: input.relaySessionId,
          sandboxInstanceId: input.sandboxInstanceId,
          stream: openResult.stream,
        }),
      );
    } catch {
      session.closeStream(openResult.stream.streamId);
      input.sendControlMessage(
        createTelemetryOpenError({
          code: "telemetry_sink_failed",
          message: TelemetrySinkFailureMessage,
          streamId: openResult.stream.streamId,
        }),
      );
      this.deleteSessionIfEmpty(sessionKey, session);
      return;
    }

    this.#sessions.set(sessionKey, session);
    input.sendControlMessage(openResult.response);
  }

  private async handleData(input: {
    delivery: Extract<TelemetryDelivery, { kind: "telemetryData" }>;
    relaySessionId: string;
    sandboxInstanceId: string;
    sendControlMessage: (message: TelemetryControlMessage) => void;
    session: BootstrapTelemetrySession;
    sessionKey: string;
  }): Promise<void> {
    const frame = decodeDataFrame(new Uint8Array(input.delivery.payload));
    const consumeResult = input.session.consumeWindow({
      payloadByteLength: frame.payload.byteLength,
      streamId: input.delivery.streamId,
    });
    if (consumeResult.kind === "reset") {
      input.sendControlMessage(consumeResult.response);
      if (consumeResult.stream !== undefined) {
        await this.closeSinkStream({
          relaySessionId: input.relaySessionId,
          sandboxInstanceId: input.sandboxInstanceId,
          stream: consumeResult.stream,
        }).catch(() => {
          // Preserve the original receive-window reset reason for the peer.
        });
      }
      this.deleteSessionIfEmpty(input.sessionKey, input.session);
      return;
    }

    try {
      await this.sink.append({
        ...toIngressStream({
          relaySessionId: input.relaySessionId,
          sandboxInstanceId: input.sandboxInstanceId,
          stream: consumeResult.stream,
        }),
        payload: frame.payload,
      });
    } catch (error) {
      input.session.closeStream(consumeResult.stream.streamId);
      try {
        await this.closeSinkStream({
          relaySessionId: input.relaySessionId,
          sandboxInstanceId: input.sandboxInstanceId,
          stream: consumeResult.stream,
        });
      } catch {
        // Preserve the original sink failure/reset reason for the peer.
      }
      input.sendControlMessage(
        this.toTelemetryReset({
          error,
          streamId: consumeResult.stream.streamId,
        }),
      );
      this.deleteSessionIfEmpty(input.sessionKey, input.session);
      return;
    }

    const replenishWindow = input.session.grantWindowIfNeeded({
      streamId: consumeResult.stream.streamId,
    });
    if (replenishWindow !== undefined) {
      input.sendControlMessage(replenishWindow);
    }
  }

  private deleteSessionIfEmpty(sessionKey: string, session: BootstrapTelemetrySession): void {
    if (session.streamCount === 0) {
      this.#sessions.delete(sessionKey);
    }
  }

  private async closeSinkStream(input: {
    relaySessionId: string;
    sandboxInstanceId: string;
    stream: ActiveBootstrapTelemetryStream;
  }): Promise<void> {
    await this.sink.closeStream(
      toIngressStream({
        relaySessionId: input.relaySessionId,
        sandboxInstanceId: input.sandboxInstanceId,
        stream: input.stream,
      }),
    );
  }

  private toTelemetryReset(input: {
    error: unknown;
    streamId: number;
  }): ReturnType<typeof createTelemetryReset> {
    if (input.error instanceof SandboxTelemetryResetError) {
      return createTelemetryReset({
        code: input.error.code,
        message: input.error.message,
        streamId: input.streamId,
      });
    }

    return createTelemetryReset({
      code: "telemetry_sink_failed",
      message: TelemetrySinkFailureMessage,
      streamId: input.streamId,
    });
  }
}
