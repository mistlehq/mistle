import {
  PayloadKindRawBytes,
  PayloadKindWebSocketBinary,
  PayloadKindWebSocketText,
  parseDetachedWorkLeaseControlMessage,
  parseStreamControlMessage,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";

import { BootstrapTunnelNotConnectedError } from "../bootstrap-tunnel-not-connected-error.js";
import type { InteractiveStreamRouter } from "../gateway-forwarding/index.js";
import {
  ClientSessionActiveStreamError,
  TunnelSessionBindingLimitExceededError,
  type ClientStreamBinding,
} from "../tunnel-session/index.js";
import type { RelayPayload, RelayPeerSide } from "../types.js";
import { FrameCodec } from "./frame-codec.js";

export type ReleaseInteractiveStream = {
  clientSessionId: string;
  clientStreamId: number;
};

export type TunnelProtocolDelivery =
  | {
      kind: "drop";
    }
  | {
      kind: "forward";
      payload: RelayPayload;
      targetConnectionSessionId?: string;
    }
  | {
      kind: "respond";
      payload: RelayPayload;
    };

export type TunnelProtocolTranslation = {
  delivery: TunnelProtocolDelivery;
  notifyBootstrapPeerOfReleasedStream?: ClientStreamBinding;
  releaseInteractiveStream?: ReleaseInteractiveStream;
};

export type TranslateTunnelInboundMessageInput = {
  clientSessionId: string;
  payload: RelayPayload;
  sandboxInstanceId: string;
  sourcePeerSide: RelayPeerSide;
};

function replaceStreamId(input: { message: StreamControlMessage; streamId: number }): string {
  return JSON.stringify({
    ...input.message,
    streamId: input.streamId,
  });
}

function parsePTYStreamOpen(payload: string) {
  const message = parseStreamControlMessage(payload);
  if (message?.type !== "stream.open" || message.channel.kind !== "pty") {
    return undefined;
  }

  return message;
}

function parseAgentStreamOpen(payload: string) {
  const message = parseStreamControlMessage(payload);
  if (message?.type !== "stream.open" || message.channel.kind !== "agent") {
    return undefined;
  }

  return message;
}

function hasPTYExitEvent(message: StreamControlMessage): boolean {
  return message.type === "stream.event" && message.event.type === "pty.exit";
}

function hasPTYResizeSignal(message: StreamControlMessage): boolean {
  return message.type === "stream.signal" && message.signal.type === "pty.resize";
}

function createStreamOpenErrorPayload(input: {
  code: string;
  message: string;
  streamId: number;
}): string {
  return JSON.stringify({
    type: "stream.open.error",
    streamId: input.streamId,
    code: input.code,
    message: input.message,
  });
}

function createStreamResetPayload(input: {
  code: string;
  message: string;
  streamId: number;
}): string {
  return JSON.stringify({
    type: "stream.reset",
    streamId: input.streamId,
    code: input.code,
    message: input.message,
  });
}

function createUnboundInteractiveStreamResetPayload(streamId: number): string {
  return createStreamResetPayload({
    code: "interactive_stream_not_found",
    message: "Interactive stream is not bound on this tunnel session.",
    streamId,
  });
}

function createInvalidStreamSignalResetPayload(streamId: number): string {
  return createStreamResetPayload({
    code: "invalid_stream_signal",
    message: "Stream signal is not valid for the bound interactive stream.",
    streamId,
  });
}

function createInvalidStreamDataResetPayload(input: {
  channelKind: ClientStreamBinding["channelKind"];
  streamId: number;
}): string {
  const message =
    input.channelKind === "pty"
      ? "PTY streams only accept raw-bytes data frames."
      : "Agent streams only accept websocket text or websocket binary data frames.";

  return createStreamResetPayload({
    code: "invalid_stream_data",
    message,
    streamId: input.streamId,
  });
}

function toStreamOpenErrorPayload(input: { error: Error; streamId: number }): string {
  if (input.error instanceof BootstrapTunnelNotConnectedError) {
    return createStreamOpenErrorPayload({
      code: "bootstrap_not_connected",
      message: input.error.message,
      streamId: input.streamId,
    });
  }
  if (input.error instanceof ClientSessionActiveStreamError) {
    return createStreamOpenErrorPayload({
      code: "client_session_already_open",
      message: input.error.message,
      streamId: input.streamId,
    });
  }
  if (input.error instanceof TunnelSessionBindingLimitExceededError) {
    return createStreamOpenErrorPayload({
      code: "max_active_streams_exceeded",
      message: input.error.message,
      streamId: input.streamId,
    });
  }

  throw input.error;
}

function createUnsupportedTextPayloadErrorMessage(side: RelayPeerSide): string {
  return side === "connection"
    ? "Connection websocket text payloads must be valid stream control messages."
    : "Bootstrap websocket text payloads must be valid stream control messages.";
}

function createUnsupportedBinaryPayloadErrorMessage(side: RelayPeerSide): string {
  return side === "connection"
    ? "Connection websocket binary payloads must be valid tunnel data frames."
    : "Bootstrap websocket binary payloads must be valid tunnel data frames.";
}

function isConnectionControlMessageAllowed(message: StreamControlMessage): boolean {
  return (
    message.type === "stream.open" ||
    message.type === "stream.signal" ||
    message.type === "stream.close" ||
    message.type === "stream.window"
  );
}

function isBootstrapControlMessageAllowed(message: StreamControlMessage): boolean {
  return (
    message.type === "stream.open.ok" ||
    message.type === "stream.open.error" ||
    message.type === "stream.event" ||
    message.type === "stream.reset" ||
    message.type === "stream.window"
  );
}

function assertConnectionControlMessageAllowed(message: StreamControlMessage): void {
  if (isConnectionControlMessageAllowed(message)) {
    return;
  }

  throw new TunnelProtocolViolationError(
    `Connection websocket cannot send control message type '${message.type}'.`,
  );
}

function assertBootstrapControlMessageAllowed(message: StreamControlMessage): void {
  if (isBootstrapControlMessageAllowed(message)) {
    return;
  }

  throw new TunnelProtocolViolationError(
    `Bootstrap websocket cannot send control message type '${message.type}'.`,
  );
}

function isPayloadKindAllowedForChannel(input: {
  channelKind: ClientStreamBinding["channelKind"];
  payloadKind: number;
}): boolean {
  if (input.channelKind === "pty") {
    return input.payloadKind === PayloadKindRawBytes;
  }

  return (
    input.payloadKind === PayloadKindWebSocketText ||
    input.payloadKind === PayloadKindWebSocketBinary
  );
}

function toReleaseInteractiveStream(binding: ClientStreamBinding): ReleaseInteractiveStream {
  return {
    clientSessionId: binding.clientSessionId,
    clientStreamId: binding.clientStreamId,
  };
}

function createForwardDelivery(input: {
  payload: RelayPayload;
  targetConnectionSessionId?: string;
}): TunnelProtocolDelivery {
  return {
    kind: "forward",
    payload: input.payload,
    ...(input.targetConnectionSessionId === undefined
      ? {}
      : {
          targetConnectionSessionId: input.targetConnectionSessionId,
        }),
  };
}

function createRespondDelivery(payload: RelayPayload): TunnelProtocolDelivery {
  return {
    kind: "respond",
    payload,
  };
}

function createTranslation(input: {
  delivery: TunnelProtocolDelivery;
  notifyBootstrapPeerOfReleasedStream?: ClientStreamBinding | undefined;
  releaseInteractiveStream?: ReleaseInteractiveStream | undefined;
}): TunnelProtocolTranslation {
  return {
    delivery: input.delivery,
    ...(input.notifyBootstrapPeerOfReleasedStream === undefined
      ? {}
      : {
          notifyBootstrapPeerOfReleasedStream: input.notifyBootstrapPeerOfReleasedStream,
        }),
    ...(input.releaseInteractiveStream === undefined
      ? {}
      : {
          releaseInteractiveStream: input.releaseInteractiveStream,
        }),
  };
}

/**
 * Raised when an inbound websocket message violates the sandbox tunnel protocol.
 */
export class TunnelProtocolViolationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TunnelProtocolViolationError";
  }
}

/**
 * Applies tunnel protocol rules to a single inbound websocket message.
 */
export class TunnelProtocolTranslator {
  public constructor(
    private readonly interactiveStreamRouter: InteractiveStreamRouter,
    private readonly frameCodec: FrameCodec = new FrameCodec(),
  ) {}

  /**
   * Translates one inbound websocket payload into a delivery decision plus any stream side effects.
   */
  public async translateInboundMessage(
    input: TranslateTunnelInboundMessageInput,
  ): Promise<TunnelProtocolTranslation> {
    if (typeof input.payload === "string") {
      return input.sourcePeerSide === "connection"
        ? this.translateConnectionTextPayload({
            clientSessionId: input.clientSessionId,
            payload: input.payload,
            sandboxInstanceId: input.sandboxInstanceId,
            sourcePeerSide: "connection",
          })
        : this.translateBootstrapTextPayload({
            clientSessionId: input.clientSessionId,
            payload: input.payload,
            sandboxInstanceId: input.sandboxInstanceId,
            sourcePeerSide: "bootstrap",
          });
    }

    return input.sourcePeerSide === "connection"
      ? this.translateConnectionBinaryPayload({
          clientSessionId: input.clientSessionId,
          payload: input.payload,
          sandboxInstanceId: input.sandboxInstanceId,
          sourcePeerSide: "connection",
        })
      : this.translateBootstrapBinaryPayload({
          clientSessionId: input.clientSessionId,
          payload: input.payload,
          sandboxInstanceId: input.sandboxInstanceId,
          sourcePeerSide: "bootstrap",
        });
  }

  private async translateConnectionTextPayload(
    input: TranslateTunnelInboundMessageInput & { payload: string; sourcePeerSide: "connection" },
  ): Promise<TunnelProtocolTranslation> {
    const ptyStreamOpen = parsePTYStreamOpen(input.payload);
    if (ptyStreamOpen !== undefined) {
      return this.translateConnectionStreamOpen({
        channelKind: "pty",
        clientSessionId: input.clientSessionId,
        message: ptyStreamOpen,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    }

    const agentStreamOpen = parseAgentStreamOpen(input.payload);
    if (agentStreamOpen !== undefined) {
      return this.translateConnectionStreamOpen({
        channelKind: "agent",
        clientSessionId: input.clientSessionId,
        message: agentStreamOpen,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    }

    const controlMessage = parseStreamControlMessage(input.payload);
    if (controlMessage === undefined) {
      throw new TunnelProtocolViolationError(
        createUnsupportedTextPayloadErrorMessage("connection"),
      );
    }
    assertConnectionControlMessageAllowed(controlMessage);

    const route = await this.interactiveStreamRouter.findInteractiveStreamByClient({
      sandboxInstanceId: input.sandboxInstanceId,
      clientSessionId: input.clientSessionId,
      clientStreamId: controlMessage.streamId,
    });
    if (route === undefined) {
      return createTranslation({
        delivery: createRespondDelivery(
          createUnboundInteractiveStreamResetPayload(controlMessage.streamId),
        ),
      });
    }

    if (controlMessage.type === "stream.signal") {
      if (route.binding.channelKind !== "pty" || !hasPTYResizeSignal(controlMessage)) {
        return createTranslation({
          delivery: createRespondDelivery(
            createInvalidStreamSignalResetPayload(controlMessage.streamId),
          ),
        });
      }
    }

    return createTranslation({
      delivery: createForwardDelivery({
        payload: replaceStreamId({
          message: controlMessage,
          streamId: route.binding.tunnelStreamId,
        }),
      }),
      releaseInteractiveStream:
        controlMessage.type === "stream.close"
          ? toReleaseInteractiveStream(route.binding)
          : undefined,
    });
  }

  private async translateConnectionStreamOpen(input: {
    channelKind: ClientStreamBinding["channelKind"];
    clientSessionId: string;
    message: Extract<StreamControlMessage, { type: "stream.open" }>;
    sandboxInstanceId: string;
  }): Promise<TunnelProtocolTranslation> {
    try {
      const route = await this.interactiveStreamRouter.openInteractiveStream({
        sandboxInstanceId: input.sandboxInstanceId,
        channelKind: input.channelKind,
        clientSessionId: input.clientSessionId,
        clientStreamId: input.message.streamId,
      });

      return createTranslation({
        delivery: createForwardDelivery({
          payload: replaceStreamId({
            message: input.message,
            streamId: route.binding.tunnelStreamId,
          }),
        }),
      });
    } catch (error) {
      if (error instanceof Error) {
        return createTranslation({
          delivery: createRespondDelivery(
            toStreamOpenErrorPayload({
              error,
              streamId: input.message.streamId,
            }),
          ),
        });
      }

      throw error;
    }
  }

  private async translateBootstrapTextPayload(
    input: TranslateTunnelInboundMessageInput & { payload: string; sourcePeerSide: "bootstrap" },
  ): Promise<TunnelProtocolTranslation> {
    const detachedWorkLeaseControlMessage = parseDetachedWorkLeaseControlMessage(input.payload);
    if (detachedWorkLeaseControlMessage !== undefined) {
      return createTranslation({
        delivery: {
          kind: "drop",
        },
      });
    }

    const controlMessage = parseStreamControlMessage(input.payload);
    if (controlMessage === undefined) {
      throw new TunnelProtocolViolationError(createUnsupportedTextPayloadErrorMessage("bootstrap"));
    }
    assertBootstrapControlMessageAllowed(controlMessage);

    const route = await this.interactiveStreamRouter.findInteractiveStreamByTunnel({
      sandboxInstanceId: input.sandboxInstanceId,
      tunnelStreamId: controlMessage.streamId,
    });
    if (route === undefined) {
      if (hasPTYExitEvent(controlMessage)) {
        return createTranslation({
          delivery: {
            kind: "drop",
          },
        });
      }

      return createTranslation({
        delivery: createRespondDelivery(
          createUnboundInteractiveStreamResetPayload(controlMessage.streamId),
        ),
      });
    }

    return createTranslation({
      delivery: createForwardDelivery({
        payload: replaceStreamId({
          message: controlMessage,
          streamId: route.binding.clientStreamId,
        }),
        targetConnectionSessionId: route.binding.clientSessionId,
      }),
      releaseInteractiveStream:
        controlMessage.type === "stream.open.error" ||
        controlMessage.type === "stream.reset" ||
        (route.binding.channelKind === "pty" && hasPTYExitEvent(controlMessage))
          ? toReleaseInteractiveStream(route.binding)
          : undefined,
    });
  }

  private async translateConnectionBinaryPayload(
    input: TranslateTunnelInboundMessageInput & {
      payload: ArrayBuffer;
      sourcePeerSide: "connection";
    },
  ): Promise<TunnelProtocolTranslation> {
    const dataFrameHeader = this.frameCodec.readDataFrameHeader(input.payload);
    if (dataFrameHeader === undefined) {
      throw new TunnelProtocolViolationError(
        createUnsupportedBinaryPayloadErrorMessage("connection"),
      );
    }

    const route = await this.interactiveStreamRouter.findInteractiveStreamByClient({
      sandboxInstanceId: input.sandboxInstanceId,
      clientSessionId: input.clientSessionId,
      clientStreamId: dataFrameHeader.streamId,
    });
    if (route === undefined) {
      return createTranslation({
        delivery: createRespondDelivery(
          createUnboundInteractiveStreamResetPayload(dataFrameHeader.streamId),
        ),
      });
    }
    if (
      !isPayloadKindAllowedForChannel({
        channelKind: route.binding.channelKind,
        payloadKind: dataFrameHeader.payloadKind,
      })
    ) {
      return createTranslation({
        delivery: createRespondDelivery(
          createInvalidStreamDataResetPayload({
            channelKind: route.binding.channelKind,
            streamId: route.binding.clientStreamId,
          }),
        ),
        notifyBootstrapPeerOfReleasedStream: route.binding,
        releaseInteractiveStream: toReleaseInteractiveStream(route.binding),
      });
    }

    const translatedPayload = this.frameCodec.rewriteStreamId({
      payload: input.payload,
      streamId: route.binding.tunnelStreamId,
    });
    if (translatedPayload === undefined) {
      return createTranslation({
        delivery: createRespondDelivery(
          createUnboundInteractiveStreamResetPayload(dataFrameHeader.streamId),
        ),
      });
    }

    return createTranslation({
      delivery: createForwardDelivery({
        payload: translatedPayload,
      }),
    });
  }

  private async translateBootstrapBinaryPayload(
    input: TranslateTunnelInboundMessageInput & {
      payload: ArrayBuffer;
      sourcePeerSide: "bootstrap";
    },
  ): Promise<TunnelProtocolTranslation> {
    const dataFrameHeader = this.frameCodec.readDataFrameHeader(input.payload);
    if (dataFrameHeader === undefined) {
      throw new TunnelProtocolViolationError(
        createUnsupportedBinaryPayloadErrorMessage("bootstrap"),
      );
    }

    const route = await this.interactiveStreamRouter.findInteractiveStreamByTunnel({
      sandboxInstanceId: input.sandboxInstanceId,
      tunnelStreamId: dataFrameHeader.streamId,
    });
    if (route === undefined) {
      return createTranslation({
        delivery: createRespondDelivery(
          createUnboundInteractiveStreamResetPayload(dataFrameHeader.streamId),
        ),
      });
    }
    if (
      !isPayloadKindAllowedForChannel({
        channelKind: route.binding.channelKind,
        payloadKind: dataFrameHeader.payloadKind,
      })
    ) {
      return createTranslation({
        delivery: createForwardDelivery({
          payload: createInvalidStreamDataResetPayload({
            channelKind: route.binding.channelKind,
            streamId: route.binding.clientStreamId,
          }),
          targetConnectionSessionId: route.binding.clientSessionId,
        }),
        notifyBootstrapPeerOfReleasedStream: route.binding,
        releaseInteractiveStream: toReleaseInteractiveStream(route.binding),
      });
    }

    const translatedPayload = this.frameCodec.rewriteStreamId({
      payload: input.payload,
      streamId: route.binding.clientStreamId,
    });
    if (translatedPayload === undefined) {
      return createTranslation({
        delivery: createRespondDelivery(
          createUnboundInteractiveStreamResetPayload(dataFrameHeader.streamId),
        ),
      });
    }

    return createTranslation({
      delivery: createForwardDelivery({
        payload: translatedPayload,
        targetConnectionSessionId: route.binding.clientSessionId,
      }),
    });
  }
}

export function createStreamClosePayload(binding: ClientStreamBinding): string {
  return JSON.stringify({
    type: "stream.close",
    streamId: binding.tunnelStreamId,
  });
}

export function createReleasedInteractiveStreamResetPayload(binding: ClientStreamBinding): string {
  const message =
    binding.channelKind === "pty"
      ? "Sandbox bootstrap tunnel reconnected and invalidated the active PTY stream."
      : "Sandbox bootstrap tunnel reconnected and invalidated the active interactive stream.";

  return createStreamResetPayload({
    code: "bootstrap_reconnected",
    message,
    streamId: binding.clientStreamId,
  });
}

export function createBootstrapDisconnectedStreamResetPayload(
  binding: ClientStreamBinding,
): string {
  const message =
    binding.channelKind === "pty"
      ? "Sandbox bootstrap tunnel disconnected and invalidated the active PTY stream."
      : "Sandbox bootstrap tunnel disconnected and invalidated the active interactive stream.";

  return createStreamResetPayload({
    code: "bootstrap_disconnected",
    message,
    streamId: binding.clientStreamId,
  });
}
