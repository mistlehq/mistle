import {
  PayloadKindRawBytes,
  PayloadKindWebSocketBinary,
  PayloadKindWebSocketText,
  parseBootstrapControlMessage,
  parseEgressTransportMessage,
  parsePortsControlMessage,
  parsePortsTransportMessage,
  parseSigningControlMessage,
  parseStreamControlMessage,
  parseTelemetryControlMessage,
  type BootstrapControlMessage,
  type KeepaliveControlMessage,
  type RuntimeReadyControlMessage,
  type EgressTransportMessage,
  type SigningRequest,
  type StreamControlMessage,
  type TelemetryClose,
  type TelemetryOpen,
} from "@mistle/sandbox-session-protocol";

import { PortAccessTransportService } from "../../publishing/port-access-transport.js";
import { PortsTargetAuthorizeService } from "../../publishing/ports-target-authorize-service.js";
import { BootstrapTunnelNotConnectedError } from "../bootstrap-tunnel-not-connected-error.js";
import type { InteractiveStreamRouter } from "../gateway-forwarding/index.js";
import {
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
      targetBootstrapSessionId?: string;
      targetConnectionSessionId?: string;
    }
  | {
      kind: "respond";
      payload: RelayPayload;
    }
  | {
      kind: "telemetryOpen";
      message: TelemetryOpen;
    }
  | {
      kind: "telemetryClose";
      message: TelemetryClose;
    }
  | {
      kind: "telemetryData";
      payload: ArrayBuffer;
      streamId: number;
    }
  | {
      kind: "telemetryInvalidData";
      payloadKind: number;
      streamId: number;
    }
  | {
      kind: "signingRequest";
      message: SigningRequest;
    }
  | {
      kind: "egressTransport";
      message: EgressTransportMessage;
    }
  | {
      kind: "egressMalformed";
      message: string;
      streamId: number;
    };

export type TunnelProtocolTranslation = {
  delivery: TunnelProtocolDelivery;
  keepaliveControlMessage?: KeepaliveControlMessage;
  runtimeReadyControlMessage?: RuntimeReadyControlMessage;
  notifyBootstrapPeerOfReleasedStream?: {
    binding: ClientStreamBinding;
    targetBootstrapSessionId: string;
  };
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

function parseProcessesStreamOpen(payload: string) {
  const message = parseStreamControlMessage(payload);
  if (message?.type !== "stream.open" || message.channel.kind !== "processes") {
    return undefined;
  }

  return message;
}

function parseFileUploadStreamOpen(payload: string) {
  const message = parseStreamControlMessage(payload);
  if (message?.type !== "stream.open" || message.channel.kind !== "fileUpload") {
    return undefined;
  }

  return message;
}

function parseExecStreamOpen(payload: string) {
  const message = parseStreamControlMessage(payload);
  if (message?.type !== "stream.open" || message.channel.kind !== "exec") {
    return undefined;
  }

  return message;
}

function hasPTYResizeSignal(message: StreamControlMessage): boolean {
  return message.type === "stream.signal" && message.signal.type === "pty.resize";
}

function shouldReleaseStreamOnConnectionClose(binding: ClientStreamBinding): boolean {
  return binding.channelKind !== "fileUpload";
}

function shouldReleaseStreamOnBootstrapMessage(input: {
  binding: ClientStreamBinding;
  message: Extract<StreamControlMessage, BootstrapControlMessage>;
}): boolean {
  if (
    input.message.type === "stream.open.error" ||
    input.message.type === "stream.reset" ||
    input.message.type === "stream.complete"
  ) {
    return true;
  }

  if (input.binding.channelKind === "pty") {
    return input.message.type === "stream.event" && input.message.event.type === "pty.exit";
  }

  return false;
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
      : input.channelKind === "fileUpload"
        ? "File upload streams only accept raw-bytes data frames."
        : input.channelKind === "processes"
          ? "Processes streams only accept websocket text data frames."
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
    : "Bootstrap websocket text payloads must be valid bootstrap control messages.";
}

function createUnsupportedBinaryPayloadErrorMessage(side: RelayPeerSide): string {
  return side === "connection"
    ? "Connection websocket binary payloads must be valid tunnel data frames."
    : "Bootstrap websocket binary payloads must be valid tunnel data frames.";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(payload: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseMalformedEgressMessage(
  payload: string,
): { message: string; streamId: number } | undefined {
  const parsed = parseJsonObject(payload);
  if (parsed === undefined || typeof parsed.type !== "string") {
    return undefined;
  }
  if (!parsed.type.startsWith("egress.")) {
    return undefined;
  }
  if (
    typeof parsed.streamId !== "number" ||
    !Number.isInteger(parsed.streamId) ||
    parsed.streamId <= 0
  ) {
    return undefined;
  }

  return {
    message: `Malformed egress transport message '${parsed.type}'.`,
    streamId: parsed.streamId,
  };
}

function createUnsupportedConnectionTelemetryMessageError(messageType: string): Error {
  return new TunnelProtocolViolationError(
    `Connection websocket cannot send telemetry control message type '${messageType}'.`,
  );
}

function createUnsupportedConnectionSigningMessageError(messageType: string): Error {
  return new TunnelProtocolViolationError(
    `Connection websocket cannot send signing control message type '${messageType}'.`,
  );
}

function isConnectionControlMessageAllowed(message: StreamControlMessage): boolean {
  return (
    message.type === "stream.open" ||
    message.type === "stream.signal" ||
    message.type === "stream.close" ||
    message.type === "stream.window"
  );
}

function isBootstrapStreamControlMessageAllowed(
  message: BootstrapControlMessage,
): message is Extract<
  BootstrapControlMessage,
  {
    type:
      | "stream.open.ok"
      | "stream.open.error"
      | "stream.complete"
      | "stream.event"
      | "stream.reset"
      | "stream.window";
  }
> {
  return (
    message.type === "stream.open.ok" ||
    message.type === "stream.open.error" ||
    message.type === "stream.complete" ||
    message.type === "stream.event" ||
    message.type === "stream.reset" ||
    message.type === "stream.window"
  );
}

function isBootstrapTelemetryControlMessageAllowed(
  message: BootstrapControlMessage,
): message is TelemetryOpen | TelemetryClose {
  return message.type === "telemetry.open" || message.type === "telemetry.close";
}

function assertConnectionControlMessageAllowed(message: StreamControlMessage): void {
  if (isConnectionControlMessageAllowed(message)) {
    return;
  }

  throw new TunnelProtocolViolationError(
    `Connection websocket cannot send control message type '${message.type}'.`,
  );
}

function assertBootstrapControlMessageAllowed(message: BootstrapControlMessage): void {
  const controlMessageType = message.type;

  if (message.type === "keepalive.state") {
    return;
  }

  if (message.type === "runtime.ready") {
    return;
  }

  if (isBootstrapStreamControlMessageAllowed(message)) {
    return;
  }

  if (isBootstrapTelemetryControlMessageAllowed(message)) {
    return;
  }

  throw new TunnelProtocolViolationError(
    `Bootstrap websocket cannot send control message type '${controlMessageType}'.`,
  );
}

function isPayloadKindAllowedForChannel(input: {
  channelKind: ClientStreamBinding["channelKind"];
  payloadKind: number;
}): boolean {
  if (input.channelKind === "pty" || input.channelKind === "fileUpload") {
    return input.payloadKind === PayloadKindRawBytes;
  }

  if (input.channelKind === "processes") {
    return input.payloadKind === PayloadKindWebSocketText;
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
  targetBootstrapSessionId?: string;
  targetConnectionSessionId?: string;
}): TunnelProtocolDelivery {
  return {
    kind: "forward",
    payload: input.payload,
    ...(input.targetBootstrapSessionId === undefined
      ? {}
      : {
          targetBootstrapSessionId: input.targetBootstrapSessionId,
        }),
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
  keepaliveControlMessage?: KeepaliveControlMessage | undefined;
  runtimeReadyControlMessage?: RuntimeReadyControlMessage | undefined;
  notifyBootstrapPeerOfReleasedStream?:
    | {
        binding: ClientStreamBinding;
        targetBootstrapSessionId: string;
      }
    | undefined;
  releaseInteractiveStream?: ReleaseInteractiveStream | undefined;
}): TunnelProtocolTranslation {
  return {
    delivery: input.delivery,
    ...(input.keepaliveControlMessage === undefined
      ? {}
      : {
          keepaliveControlMessage: input.keepaliveControlMessage,
        }),
    ...(input.runtimeReadyControlMessage === undefined
      ? {}
      : {
          runtimeReadyControlMessage: input.runtimeReadyControlMessage,
        }),
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
    private readonly portsTargetAuthorizeService: PortsTargetAuthorizeService,
    private readonly portAccessTransportService: PortAccessTransportService,
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
    const portsControlMessage = parsePortsControlMessage(input.payload);
    if (portsControlMessage?.type === "ports.target.authorize") {
      await this.portsTargetAuthorizeService.forwardConnectionTargetAuthorize({
        sandboxInstanceId: input.sandboxInstanceId,
        clientSessionId: input.clientSessionId,
        request: portsControlMessage,
      });

      return createTranslation({
        delivery: {
          kind: "drop",
        },
      });
    }

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

    const processesStreamOpen = parseProcessesStreamOpen(input.payload);
    if (processesStreamOpen !== undefined) {
      return this.translateConnectionStreamOpen({
        channelKind: "processes",
        clientSessionId: input.clientSessionId,
        message: processesStreamOpen,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    }

    const fileUploadStreamOpen = parseFileUploadStreamOpen(input.payload);
    if (fileUploadStreamOpen !== undefined) {
      return this.translateConnectionStreamOpen({
        channelKind: "fileUpload",
        clientSessionId: input.clientSessionId,
        message: fileUploadStreamOpen,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    }

    const execStreamOpen = parseExecStreamOpen(input.payload);
    if (execStreamOpen !== undefined) {
      return this.translateConnectionStreamOpen({
        channelKind: "exec",
        clientSessionId: input.clientSessionId,
        message: execStreamOpen,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    }

    const telemetryControlMessage = parseTelemetryControlMessage(input.payload);
    if (telemetryControlMessage !== undefined) {
      throw createUnsupportedConnectionTelemetryMessageError(telemetryControlMessage.type);
    }

    const signingControlMessage = parseSigningControlMessage(input.payload);
    if (signingControlMessage !== undefined) {
      throw createUnsupportedConnectionSigningMessageError(signingControlMessage.type);
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
        targetBootstrapSessionId: route.bootstrapTarget.sessionId,
      }),
      releaseInteractiveStream:
        controlMessage.type === "stream.close" &&
        shouldReleaseStreamOnConnectionClose(route.binding)
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
          targetBootstrapSessionId: route.bootstrapTarget.sessionId,
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
    const portsControlMessage = parsePortsControlMessage(input.payload);
    if (portsControlMessage?.type === "ports.target.authorize.result") {
      const resolution = this.portsTargetAuthorizeService.resolveTargetAuthorizeResult({
        sandboxInstanceId: input.sandboxInstanceId,
        sourceBootstrapSessionId: input.clientSessionId,
        result: portsControlMessage,
      });

      if (resolution?.kind === "forward") {
        return createTranslation({
          delivery: createForwardDelivery({
            payload: JSON.stringify(resolution.result),
            targetConnectionSessionId: resolution.targetConnectionSessionId,
          }),
        });
      }

      return createTranslation({
        delivery: {
          kind: "drop",
        },
      });
    }

    const portsTransportMessage = parsePortsTransportMessage(input.payload);
    if (portsTransportMessage !== undefined) {
      if (
        portsTransportMessage.type === "ports.http.response.start" ||
        portsTransportMessage.type === "ports.http.body.chunk" ||
        portsTransportMessage.type === "ports.http.body.end" ||
        portsTransportMessage.type === "ports.tcp.connected" ||
        portsTransportMessage.type === "ports.tcp.close" ||
        portsTransportMessage.type === "ports.tcp.error" ||
        portsTransportMessage.type === "ports.stream.error"
      ) {
        await this.portAccessTransportService.handleBootstrapTransportMessage({
          sandboxInstanceId: input.sandboxInstanceId,
          sourceBootstrapSessionId: input.clientSessionId,
          message: portsTransportMessage,
        });

        return createTranslation({
          delivery: {
            kind: "drop",
          },
        });
      }

      throw new TunnelProtocolViolationError(
        `Bootstrap websocket cannot send ports transport message type '${portsTransportMessage.type}'.`,
      );
    }

    const egressTransportMessage = parseEgressTransportMessage(input.payload);
    if (egressTransportMessage !== undefined) {
      return createTranslation({
        delivery: {
          kind: "egressTransport",
          message: egressTransportMessage,
        },
      });
    }

    const malformedEgressMessage = parseMalformedEgressMessage(input.payload);
    if (malformedEgressMessage !== undefined) {
      return createTranslation({
        delivery: {
          kind: "egressMalformed",
          message: malformedEgressMessage.message,
          streamId: malformedEgressMessage.streamId,
        },
      });
    }

    const signingControlMessage = parseSigningControlMessage(input.payload);
    if (signingControlMessage !== undefined) {
      if (signingControlMessage.type !== "signing.request") {
        throw new TunnelProtocolViolationError(
          `Bootstrap websocket cannot send signing control message type '${signingControlMessage.type}'.`,
        );
      }

      return createTranslation({
        delivery: {
          kind: "signingRequest",
          message: signingControlMessage,
        },
      });
    }

    const controlMessage = parseBootstrapControlMessage(input.payload);
    if (controlMessage === undefined) {
      throw new TunnelProtocolViolationError(createUnsupportedTextPayloadErrorMessage("bootstrap"));
    }
    assertBootstrapControlMessageAllowed(controlMessage);
    if (controlMessage.type === "keepalive.state") {
      return createTranslation({
        delivery: {
          kind: "drop",
        },
        keepaliveControlMessage: controlMessage,
      });
    }

    if (controlMessage.type === "runtime.ready") {
      return createTranslation({
        delivery: {
          kind: "drop",
        },
        runtimeReadyControlMessage: controlMessage,
      });
    }

    if (controlMessage.type === "telemetry.open") {
      return createTranslation({
        delivery: {
          kind: "telemetryOpen",
          message: controlMessage,
        },
      });
    }

    if (controlMessage.type === "telemetry.close") {
      return createTranslation({
        delivery: {
          kind: "telemetryClose",
          message: controlMessage,
        },
      });
    }

    if (
      controlMessage.type === "stream.window" &&
      this.portAccessTransportService.handleBootstrapStreamWindow({
        sandboxInstanceId: input.sandboxInstanceId,
        sourceBootstrapSessionId: input.clientSessionId,
        message: controlMessage,
      })
    ) {
      return createTranslation({
        delivery: {
          kind: "drop",
        },
      });
    }

    const route = await this.interactiveStreamRouter.findInteractiveStreamByTunnel({
      sandboxInstanceId: input.sandboxInstanceId,
      tunnelStreamId: controlMessage.streamId,
    });
    if (route === undefined) {
      return createTranslation({
        delivery: {
          kind: "drop",
        },
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
      releaseInteractiveStream: shouldReleaseStreamOnBootstrapMessage({
        binding: route.binding,
        message: controlMessage,
      })
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
        notifyBootstrapPeerOfReleasedStream: {
          binding: route.binding,
          targetBootstrapSessionId: route.bootstrapTarget.sessionId,
        },
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
        targetBootstrapSessionId: route.bootstrapTarget.sessionId,
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

    if (
      await this.portAccessTransportService.handleBootstrapDataFrame({
        payload: input.payload,
        sandboxInstanceId: input.sandboxInstanceId,
        sourceBootstrapSessionId: input.clientSessionId,
      })
    ) {
      return createTranslation({
        delivery: {
          kind: "drop",
        },
      });
    }

    const route = await this.interactiveStreamRouter.findInteractiveStreamByTunnel({
      sandboxInstanceId: input.sandboxInstanceId,
      tunnelStreamId: dataFrameHeader.streamId,
    });
    if (route === undefined) {
      if (dataFrameHeader.payloadKind !== PayloadKindRawBytes) {
        return createTranslation({
          delivery: {
            kind: "telemetryInvalidData",
            streamId: dataFrameHeader.streamId,
            payloadKind: dataFrameHeader.payloadKind,
          },
        });
      }

      return createTranslation({
        delivery: {
          kind: "telemetryData",
          payload: input.payload,
          streamId: dataFrameHeader.streamId,
        },
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
        notifyBootstrapPeerOfReleasedStream: {
          binding: route.binding,
          targetBootstrapSessionId: route.bootstrapTarget.sessionId,
        },
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
