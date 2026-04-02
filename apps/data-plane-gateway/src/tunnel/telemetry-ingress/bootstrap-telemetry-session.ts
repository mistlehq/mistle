import {
  DefaultStreamWindowBytes,
  type TelemetryFormat,
  type TelemetrySignal,
} from "@mistle/sandbox-session-protocol";

import {
  createTelemetryOpenError,
  createTelemetryOpenOk,
  createTelemetryReset,
  createTelemetryWindow,
} from "./telemetry-control-messages.js";

export type ActiveBootstrapTelemetryStream = {
  format: TelemetryFormat;
  remainingWindowBytes: number;
  signal: TelemetrySignal;
  streamId: number;
};

type OpenBootstrapTelemetryStreamResult =
  | {
      kind: "ok";
      response: ReturnType<typeof createTelemetryOpenOk>;
      stream: ActiveBootstrapTelemetryStream;
    }
  | {
      kind: "error";
      response: ReturnType<typeof createTelemetryOpenError>;
    };

type ConsumeTelemetryWindowResult =
  | {
      kind: "ok";
      stream: ActiveBootstrapTelemetryStream;
    }
  | {
      kind: "reset";
      response: ReturnType<typeof createTelemetryReset>;
      stream: ActiveBootstrapTelemetryStream | undefined;
    };

export class BootstrapTelemetrySession {
  readonly #streamsById = new Map<number, ActiveBootstrapTelemetryStream>();
  readonly #streamIdsBySignal = new Map<TelemetrySignal, number>();

  public constructor(private readonly initialWindowBytes: number = DefaultStreamWindowBytes) {}

  public openStream(input: {
    format: TelemetryFormat;
    signal: TelemetrySignal;
    streamId: number;
  }): OpenBootstrapTelemetryStreamResult {
    const existingStream = this.#streamsById.get(input.streamId);
    if (existingStream !== undefined) {
      return {
        kind: "error",
        response: createTelemetryOpenError({
          code: "telemetry_stream_already_open",
          message: `Telemetry stream ${String(input.streamId)} is already open.`,
          streamId: input.streamId,
        }),
      };
    }

    const existingSignalStreamId = this.#streamIdsBySignal.get(input.signal);
    if (existingSignalStreamId !== undefined) {
      return {
        kind: "error",
        response: createTelemetryOpenError({
          code: "telemetry_stream_already_open",
          message: `A logs telemetry stream is already active for this bootstrap session.`,
          streamId: input.streamId,
        }),
      };
    }

    const stream: ActiveBootstrapTelemetryStream = {
      format: input.format,
      remainingWindowBytes: this.initialWindowBytes,
      signal: input.signal,
      streamId: input.streamId,
    };
    this.#streamsById.set(stream.streamId, stream);
    this.#streamIdsBySignal.set(stream.signal, stream.streamId);

    return {
      kind: "ok",
      response: createTelemetryOpenOk({
        initialWindowBytes: this.initialWindowBytes,
        streamId: stream.streamId,
      }),
      stream,
    };
  }

  public closeStream(streamId: number): ActiveBootstrapTelemetryStream | undefined {
    const stream = this.#streamsById.get(streamId);
    if (stream === undefined) {
      return undefined;
    }

    this.#streamsById.delete(streamId);
    this.#streamIdsBySignal.delete(stream.signal);
    return stream;
  }

  public closeAllStreams(): ActiveBootstrapTelemetryStream[] {
    const streams = Array.from(this.#streamsById.values());
    this.#streamsById.clear();
    this.#streamIdsBySignal.clear();
    return streams;
  }

  public consumeWindow(input: {
    payloadByteLength: number;
    streamId: number;
  }): ConsumeTelemetryWindowResult {
    const stream = this.#streamsById.get(input.streamId);
    if (stream === undefined) {
      return {
        kind: "reset",
        response: createTelemetryReset({
          code: "telemetry_stream_not_found",
          message: `Telemetry stream ${String(input.streamId)} is not open on this bootstrap session.`,
          streamId: input.streamId,
        }),
        stream: undefined,
      };
    }

    if (input.payloadByteLength > stream.remainingWindowBytes) {
      this.closeStream(stream.streamId);
      return {
        kind: "reset",
        response: createTelemetryReset({
          code: "telemetry_window_exhausted",
          message: `Telemetry stream ${String(input.streamId)} exhausted its receive window.`,
          streamId: input.streamId,
        }),
        stream,
      };
    }

    stream.remainingWindowBytes -= input.payloadByteLength;
    return {
      kind: "ok",
      stream,
    };
  }

  public restoreWindow(input: {
    bytes: number;
    streamId: number;
  }): ReturnType<typeof createTelemetryWindow> | undefined {
    if (input.bytes === 0) {
      return undefined;
    }

    const stream = this.#streamsById.get(input.streamId);
    if (stream === undefined) {
      return undefined;
    }

    stream.remainingWindowBytes += input.bytes;
    return createTelemetryWindow({
      bytes: input.bytes,
      streamId: input.streamId,
    });
  }

  public invalidateStream(input: { payloadKind: number; streamId: number }): {
    response: ReturnType<typeof createTelemetryReset>;
    stream: ActiveBootstrapTelemetryStream | undefined;
  } {
    const stream = this.closeStream(input.streamId);
    if (stream === undefined) {
      return {
        response: createTelemetryReset({
          code: "telemetry_stream_not_found",
          message: `Telemetry stream ${String(input.streamId)} is not open on this bootstrap session.`,
          streamId: input.streamId,
        }),
        stream: undefined,
      };
    }

    return {
      response: createTelemetryReset({
        code: "invalid_telemetry_payload_kind",
        message: "Telemetry streams only accept raw-bytes payloads.",
        streamId: input.streamId,
      }),
      stream,
    };
  }

  public get streamCount(): number {
    return this.#streamsById.size;
  }
}
