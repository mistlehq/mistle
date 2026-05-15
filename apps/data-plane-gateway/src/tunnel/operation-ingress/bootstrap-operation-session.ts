import {
  DefaultStreamWindowBytes,
  type SandboxOperationKind,
} from "@mistle/sandbox-session-protocol";

import {
  createOperationOpenError,
  createOperationOpenOk,
  createOperationReset,
  createOperationWindow,
} from "./operation-control-messages.js";

export type ActiveBootstrapOperationStream = {
  consumedSinceLastWindowGrantBytes: number;
  operationId: string;
  operationKind: SandboxOperationKind;
  remainingWindowBytes: number;
  streamId: number;
};

const OperationWindowGrantBatchBytes = 16 * 1024;
const OperationStreamFormat = "mistle.sandbox-operation.v1+jsonl";
const OperationStreamId = 0xffff_fffd;

type OpenBootstrapOperationStreamResult =
  | {
      kind: "ok";
      response: ReturnType<typeof createOperationOpenOk>;
      stream: ActiveBootstrapOperationStream;
    }
  | {
      kind: "error";
      response: ReturnType<typeof createOperationOpenError>;
    };

type ConsumeOperationWindowResult =
  | {
      kind: "ok";
      stream: ActiveBootstrapOperationStream;
    }
  | {
      kind: "reset";
      response: ReturnType<typeof createOperationReset>;
      stream: ActiveBootstrapOperationStream | undefined;
    };

export class BootstrapOperationSession {
  readonly #streamsById = new Map<number, ActiveBootstrapOperationStream>();

  public constructor(
    private readonly initialWindowBytes: number = DefaultStreamWindowBytes,
    private readonly windowGrantBatchBytes: number = OperationWindowGrantBatchBytes,
  ) {}

  public openStream(input: {
    format: string;
    operationId: string;
    operationKind: SandboxOperationKind;
    streamId: number;
  }): OpenBootstrapOperationStreamResult {
    if (input.streamId !== OperationStreamId) {
      return {
        kind: "error",
        response: createOperationOpenError({
          code: "unsupported_operation_stream",
          message: `Operation stream ${String(input.streamId)} is not reserved for sandbox operation records.`,
          streamId: input.streamId,
        }),
      };
    }

    if (input.format !== OperationStreamFormat) {
      return {
        kind: "error",
        response: createOperationOpenError({
          code: "unsupported_operation_stream",
          message: `Operation stream format '${input.format}' is not supported.`,
          streamId: input.streamId,
        }),
      };
    }

    if (this.#streamsById.has(input.streamId)) {
      return {
        kind: "error",
        response: createOperationOpenError({
          code: "operation_stream_already_open",
          message: `Operation stream ${String(input.streamId)} is already open.`,
          streamId: input.streamId,
        }),
      };
    }

    const stream: ActiveBootstrapOperationStream = {
      consumedSinceLastWindowGrantBytes: 0,
      operationId: input.operationId,
      operationKind: input.operationKind,
      remainingWindowBytes: this.initialWindowBytes,
      streamId: input.streamId,
    };
    this.#streamsById.set(stream.streamId, stream);

    return {
      kind: "ok",
      response: createOperationOpenOk({
        initialWindowBytes: this.initialWindowBytes,
        streamId: stream.streamId,
      }),
      stream,
    };
  }

  public closeStream(streamId: number): ActiveBootstrapOperationStream | undefined {
    const stream = this.#streamsById.get(streamId);
    if (stream === undefined) {
      return undefined;
    }

    this.#streamsById.delete(streamId);
    return stream;
  }

  public closeAllStreams(): ActiveBootstrapOperationStream[] {
    const streams = Array.from(this.#streamsById.values());
    this.#streamsById.clear();
    return streams;
  }

  public consumeWindow(input: {
    payloadByteLength: number;
    streamId: number;
  }): ConsumeOperationWindowResult {
    const stream = this.#streamsById.get(input.streamId);
    if (stream === undefined) {
      return {
        kind: "reset",
        response: createOperationReset({
          code: "operation_stream_not_found",
          message: `Operation stream ${String(input.streamId)} is not open on this bootstrap session.`,
          streamId: input.streamId,
        }),
        stream: undefined,
      };
    }

    if (input.payloadByteLength > stream.remainingWindowBytes) {
      this.closeStream(stream.streamId);
      return {
        kind: "reset",
        response: createOperationReset({
          code: "operation_window_exhausted",
          message: `Operation stream ${String(input.streamId)} exhausted its receive window.`,
          streamId: input.streamId,
        }),
        stream,
      };
    }

    stream.remainingWindowBytes -= input.payloadByteLength;
    stream.consumedSinceLastWindowGrantBytes += input.payloadByteLength;
    return {
      kind: "ok",
      stream,
    };
  }

  public grantWindowIfNeeded(input: {
    streamId: number;
  }): ReturnType<typeof createOperationWindow> | undefined {
    const stream = this.#streamsById.get(input.streamId);
    if (stream === undefined) {
      return undefined;
    }

    if (stream.consumedSinceLastWindowGrantBytes < this.windowGrantBatchBytes) {
      return undefined;
    }

    const grantedBytes = stream.consumedSinceLastWindowGrantBytes;
    stream.consumedSinceLastWindowGrantBytes = 0;
    stream.remainingWindowBytes += grantedBytes;
    return createOperationWindow({
      bytes: grantedBytes,
      streamId: input.streamId,
    });
  }

  public get streamCount(): number {
    return this.#streamsById.size;
  }
}
