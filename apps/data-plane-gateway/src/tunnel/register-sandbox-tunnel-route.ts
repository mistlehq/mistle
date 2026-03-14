import type { NodeWebSocket } from "@hono/node-ws";
import {
  ConnectionTokenError,
  type ConnectionTokenConfig,
  verifyConnectionToken,
} from "@mistle/gateway-connection-auth";
import {
  BootstrapTokenError,
  type BootstrapTokenConfig,
  verifyBootstrapToken,
} from "@mistle/gateway-tunnel-auth";
import {
  DataFrameHeaderByteLength,
  DataFrameKindData,
  MaxStreamId,
  PayloadKindRawBytes,
  PayloadKindWebSocketBinary,
  PayloadKindWebSocketText,
  parseStreamControlMessage,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import type { WSContext, WSMessageReceive } from "hono/ws";
import { typeid } from "typeid-js";

import { logger } from "../logger.js";
import type { DataPlaneGatewayApp } from "../types.js";
import { BootstrapTunnelNotConnectedError } from "./bootstrap-tunnel-not-connected-error.js";
import { insertSandboxTunnelConnectAck } from "./connect-ack.js";
import type { InteractiveStreamRouter } from "./gateway-forwarding/index.js";
import type { SandboxOwnerLeaseHeartbeat } from "./ownership/sandbox-owner-lease-heartbeat.js";
import type { SandboxOwnerResolver } from "./ownership/sandbox-owner-resolver.js";
import type { SandboxOwnerStore } from "./ownership/sandbox-owner-store.js";
import type { TunnelRelayCoordinator } from "./relay-coordinator.js";
import {
  classifySandboxTunnelClose,
  getSandboxTunnelSessionAttributes,
  getSandboxTunnelSessionSpanName,
} from "./telemetry.js";
import {
  markSandboxTunnelConnected,
  markSandboxTunnelDisconnected,
  markSandboxTunnelSeen,
} from "./tunnel-liveliness-store.js";
import {
  ClientSessionActiveStreamError,
  TunnelSessionBindingLimitExceededError,
  type ClientStreamBinding,
  type TunnelSessionRegistry,
} from "./tunnel-session/index.js";
import type { RelayPeerSide, RelayTarget } from "./types.js";

const SandboxTunnelRoutePath = "/tunnel/sandbox/:instanceId";

type RegisterSandboxTunnelRouteInput = {
  app: DataPlaneGatewayApp;
  upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
  gatewayNodeId: string;
  bootstrapTokenConfig: BootstrapTokenConfig;
  connectionTokenConfig: ConnectionTokenConfig;
  interactiveStreamRouter: InteractiveStreamRouter;
  relayCoordinator: TunnelRelayCoordinator;
  tunnelSessionRegistry: TunnelSessionRegistry;
  sandboxOwnerStore: SandboxOwnerStore;
  sandboxOwnerResolver: SandboxOwnerResolver;
  sandboxOwnerLeaseHeartbeat: SandboxOwnerLeaseHeartbeat;
};

type TokenKind = "bootstrap" | "connection";
type RequestedToken =
  | {
      kind: "missing";
    }
  | {
      kind: "ambiguous";
    }
  | {
      kind: TokenKind;
      token: string;
    };

const CloseCodes: {
  INTERNAL_ERROR: number;
  PROTOCOL_ERROR: number;
} = {
  INTERNAL_ERROR: 1011,
  PROTOCOL_ERROR: 1008,
};
const OwnerLeaseTtlMs = 30_000;
const TunnelLifecycleTracer = trace.getTracer("@mistle/data-plane-gateway");

function toNormalizedTokenValue(token: string | null): string | undefined {
  const normalizedToken = token?.trim();
  if (normalizedToken === undefined || normalizedToken.length === 0) {
    return undefined;
  }

  return normalizedToken;
}

function readRequestedTokenFromRequestUrl(url: URL): RequestedToken {
  const bootstrapToken = url.searchParams.get("bootstrap_token");
  const connectionToken = url.searchParams.get("connect_token");
  const normalizedBootstrapToken = toNormalizedTokenValue(bootstrapToken);
  const normalizedConnectionToken = toNormalizedTokenValue(connectionToken);

  if (normalizedBootstrapToken !== undefined && normalizedConnectionToken !== undefined) {
    return { kind: "ambiguous" };
  }

  if (normalizedBootstrapToken !== undefined) {
    return { kind: "bootstrap", token: normalizedBootstrapToken };
  }
  if (normalizedConnectionToken !== undefined) {
    return { kind: "connection", token: normalizedConnectionToken };
  }

  return { kind: "missing" };
}

async function verifyRequestedToken(input: {
  requestedToken: RequestedToken;
  bootstrapTokenConfig: BootstrapTokenConfig;
  connectionTokenConfig: ConnectionTokenConfig;
}): Promise<{ tokenKind: TokenKind; tokenJti: string; tokenSandboxInstanceId: string }> {
  if (input.requestedToken.kind === "missing" || input.requestedToken.kind === "ambiguous") {
    throw new Error("Expected a token-bearing request.");
  }

  if (input.requestedToken.kind === "bootstrap") {
    const verificationResult = await verifyBootstrapToken({
      config: input.bootstrapTokenConfig,
      token: input.requestedToken.token,
    });
    return {
      tokenKind: "bootstrap",
      tokenJti: verificationResult.jti,
      tokenSandboxInstanceId: verificationResult.sandboxInstanceId,
    };
  }

  const verificationResult = await verifyConnectionToken({
    config: input.connectionTokenConfig,
    token: input.requestedToken.token,
  });
  return {
    tokenKind: "connection",
    tokenJti: verificationResult.jti,
    tokenSandboxInstanceId: verificationResult.sandboxInstanceId,
  };
}

function toForwardPayload(data: WSMessageReceive): string | ArrayBuffer | undefined {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return data;
  }

  return undefined;
}

function toSourcePeerSide(tokenKind: TokenKind): RelayPeerSide {
  return tokenKind;
}

function parsePTYStreamOpen(payload: string) {
  const message = parseStreamControlMessage(payload);
  if (message?.type !== "stream.open" || message.channel.kind !== "pty") {
    return undefined;
  }

  return message;
}

function replaceStreamId(input: { message: StreamControlMessage; streamId: number }): string {
  return JSON.stringify({
    ...input.message,
    streamId: input.streamId,
  });
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

class TunnelProtocolViolationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TunnelProtocolViolationError";
  }
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

async function translateConnectionPayloadToBootstrap(input: {
  clientSessionId: string;
  interactiveStreamRouter: InteractiveStreamRouter;
  payload: string;
  sandboxInstanceId: string;
}): Promise<RoutedTunnelMessage> {
  const ptyStreamOpen = parsePTYStreamOpen(input.payload);
  if (ptyStreamOpen !== undefined) {
    try {
      const route = await input.interactiveStreamRouter.openInteractiveStream({
        sandboxInstanceId: input.sandboxInstanceId,
        channelKind: "pty",
        clientSessionId: input.clientSessionId,
        clientStreamId: ptyStreamOpen.streamId,
      });

      return {
        payload: replaceStreamId({
          message: ptyStreamOpen,
          streamId: route.binding.tunnelStreamId,
        }),
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          payload: toStreamOpenErrorPayload({
            error,
            streamId: ptyStreamOpen.streamId,
          }),
          respondToCurrentPeer: true,
        };
      }

      throw error;
    }
  }

  const agentStreamOpen = parseAgentStreamOpen(input.payload);
  if (agentStreamOpen !== undefined) {
    try {
      const route = await input.interactiveStreamRouter.openInteractiveStream({
        sandboxInstanceId: input.sandboxInstanceId,
        channelKind: "agent",
        clientSessionId: input.clientSessionId,
        clientStreamId: agentStreamOpen.streamId,
      });

      return {
        payload: replaceStreamId({
          message: agentStreamOpen,
          streamId: route.binding.tunnelStreamId,
        }),
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          payload: toStreamOpenErrorPayload({
            error,
            streamId: agentStreamOpen.streamId,
          }),
          respondToCurrentPeer: true,
        };
      }

      throw error;
    }
  }

  const controlMessage = parseStreamControlMessage(input.payload);
  if (controlMessage === undefined) {
    throw new TunnelProtocolViolationError(createUnsupportedTextPayloadErrorMessage("connection"));
  }
  assertConnectionControlMessageAllowed(controlMessage);

  const route = await input.interactiveStreamRouter.findInteractiveStreamByClient({
    sandboxInstanceId: input.sandboxInstanceId,
    clientSessionId: input.clientSessionId,
    clientStreamId: controlMessage.streamId,
  });
  if (route === undefined) {
    return {
      payload: createUnboundInteractiveStreamResetPayload(controlMessage.streamId),
      respondToCurrentPeer: true,
    };
  }

  if (controlMessage.type === "stream.signal") {
    if (route.binding.channelKind !== "pty" || !hasPTYResizeSignal(controlMessage)) {
      return {
        payload: createInvalidStreamSignalResetPayload(controlMessage.streamId),
        respondToCurrentPeer: true,
      };
    }
  }

  return {
    payload: replaceStreamId({
      message: controlMessage,
      streamId: route.binding.tunnelStreamId,
    }),
    releaseInteractiveStream:
      controlMessage.type === "stream.close"
        ? {
            clientSessionId: route.binding.clientSessionId,
            clientStreamId: route.binding.clientStreamId,
          }
        : undefined,
  };
}

async function translateBootstrapPayloadToConnection(input: {
  interactiveStreamRouter: InteractiveStreamRouter;
  payload: string;
  sandboxInstanceId: string;
}): Promise<RoutedTunnelMessage> {
  const controlMessage = parseStreamControlMessage(input.payload);
  if (controlMessage === undefined) {
    throw new TunnelProtocolViolationError(createUnsupportedTextPayloadErrorMessage("bootstrap"));
  }
  assertBootstrapControlMessageAllowed(controlMessage);

  const route = await input.interactiveStreamRouter.findInteractiveStreamByTunnel({
    sandboxInstanceId: input.sandboxInstanceId,
    tunnelStreamId: controlMessage.streamId,
  });
  if (route === undefined) {
    if (hasPTYExitEvent(controlMessage)) {
      return {
        payload: input.payload,
        dropMessage: true,
      };
    }

    return {
      payload: createUnboundInteractiveStreamResetPayload(controlMessage.streamId),
      respondToCurrentPeer: true,
    };
  }

  return {
    payload: replaceStreamId({
      message: controlMessage,
      streamId: route.binding.clientStreamId,
    }),
    targetConnectionSessionId: route.binding.clientSessionId,
    releaseInteractiveStream:
      controlMessage.type === "stream.open.error" ||
      controlMessage.type === "stream.reset" ||
      (route.binding.channelKind === "pty" && hasPTYExitEvent(controlMessage))
        ? {
            clientSessionId: route.binding.clientSessionId,
            clientStreamId: route.binding.clientStreamId,
          }
        : undefined,
  };
}

function createStreamClosePayload(binding: ClientStreamBinding): string {
  return JSON.stringify({
    type: "stream.close",
    streamId: binding.tunnelStreamId,
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

function replaceDataFrameStreamId(input: {
  payload: ArrayBuffer;
  streamId: number;
}): ArrayBuffer | undefined {
  if (!Number.isInteger(input.streamId) || input.streamId <= 0 || input.streamId > MaxStreamId) {
    return undefined;
  }

  const remappedPayload = input.payload.slice(0);
  const view = new DataView(remappedPayload);

  if (view.byteLength < DataFrameHeaderByteLength) {
    return undefined;
  }

  if (view.getUint8(0) !== DataFrameKindData) {
    return undefined;
  }

  const currentStreamId = view.getUint32(1);
  if (currentStreamId === 0 || currentStreamId > MaxStreamId) {
    return undefined;
  }

  const payloadKind = view.getUint8(5);
  if (!isSupportedDataFramePayloadKind(payloadKind)) {
    return undefined;
  }

  view.setUint32(1, input.streamId);

  return remappedPayload;
}

type RoutedTunnelMessage = {
  payload: string | ArrayBuffer;
  dropMessage?: boolean | undefined;
  respondToCurrentPeer?: boolean | undefined;
  targetConnectionSessionId?: string | undefined;
  notifyBootstrapPeerOfReleasedStream?: ClientStreamBinding | undefined;
  releaseInteractiveStream?:
    | {
        clientSessionId: string;
        clientStreamId: number;
      }
    | undefined;
};

function isSupportedDataFramePayloadKind(payloadKind: number): boolean {
  return (
    payloadKind === PayloadKindRawBytes ||
    payloadKind === PayloadKindWebSocketText ||
    payloadKind === PayloadKindWebSocketBinary
  );
}

function readDataFrameHeader(
  payload: ArrayBuffer,
): { payloadKind: number; streamId: number } | undefined {
  const view = new DataView(payload);
  if (view.byteLength < DataFrameHeaderByteLength) {
    return undefined;
  }

  if (view.getUint8(0) !== DataFrameKindData) {
    return undefined;
  }

  const streamId = view.getUint32(1);
  if (streamId === 0 || streamId > MaxStreamId) {
    return undefined;
  }

  const payloadKind = view.getUint8(5);
  if (!isSupportedDataFramePayloadKind(payloadKind)) {
    return undefined;
  }

  return {
    payloadKind,
    streamId,
  };
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

async function translateConnectionBinaryPayloadToBootstrap(input: {
  clientSessionId: string;
  interactiveStreamRouter: InteractiveStreamRouter;
  payload: ArrayBuffer;
  sandboxInstanceId: string;
}): Promise<RoutedTunnelMessage> {
  const dataFrameHeader = readDataFrameHeader(input.payload);
  if (dataFrameHeader === undefined) {
    throw new TunnelProtocolViolationError(
      createUnsupportedBinaryPayloadErrorMessage("connection"),
    );
  }

  const route = await input.interactiveStreamRouter.findInteractiveStreamByClient({
    sandboxInstanceId: input.sandboxInstanceId,
    clientSessionId: input.clientSessionId,
    clientStreamId: dataFrameHeader.streamId,
  });
  if (route === undefined) {
    return {
      payload: createUnboundInteractiveStreamResetPayload(dataFrameHeader.streamId),
      respondToCurrentPeer: true,
    };
  }
  if (
    !isPayloadKindAllowedForChannel({
      channelKind: route.binding.channelKind,
      payloadKind: dataFrameHeader.payloadKind,
    })
  ) {
    return {
      payload: createInvalidStreamDataResetPayload({
        channelKind: route.binding.channelKind,
        streamId: route.binding.clientStreamId,
      }),
      notifyBootstrapPeerOfReleasedStream: route.binding,
      releaseInteractiveStream: {
        clientSessionId: route.binding.clientSessionId,
        clientStreamId: route.binding.clientStreamId,
      },
      respondToCurrentPeer: true,
    };
  }

  const translatedPayload = replaceDataFrameStreamId({
    payload: input.payload,
    streamId: route.binding.tunnelStreamId,
  });
  if (translatedPayload === undefined) {
    return {
      payload: createUnboundInteractiveStreamResetPayload(dataFrameHeader.streamId),
      respondToCurrentPeer: true,
    };
  }

  return {
    payload: translatedPayload,
  };
}

async function translateBootstrapBinaryPayloadToConnection(input: {
  interactiveStreamRouter: InteractiveStreamRouter;
  payload: ArrayBuffer;
  sandboxInstanceId: string;
}): Promise<RoutedTunnelMessage> {
  const dataFrameHeader = readDataFrameHeader(input.payload);
  if (dataFrameHeader === undefined) {
    throw new TunnelProtocolViolationError(createUnsupportedBinaryPayloadErrorMessage("bootstrap"));
  }

  const route = await input.interactiveStreamRouter.findInteractiveStreamByTunnel({
    sandboxInstanceId: input.sandboxInstanceId,
    tunnelStreamId: dataFrameHeader.streamId,
  });
  if (route === undefined) {
    return {
      payload: createUnboundInteractiveStreamResetPayload(dataFrameHeader.streamId),
      respondToCurrentPeer: true,
    };
  }
  if (
    !isPayloadKindAllowedForChannel({
      channelKind: route.binding.channelKind,
      payloadKind: dataFrameHeader.payloadKind,
    })
  ) {
    return {
      payload: createInvalidStreamDataResetPayload({
        channelKind: route.binding.channelKind,
        streamId: route.binding.clientStreamId,
      }),
      notifyBootstrapPeerOfReleasedStream: route.binding,
      releaseInteractiveStream: {
        clientSessionId: route.binding.clientSessionId,
        clientStreamId: route.binding.clientStreamId,
      },
      targetConnectionSessionId: route.binding.clientSessionId,
    };
  }

  const translatedPayload = replaceDataFrameStreamId({
    payload: input.payload,
    streamId: route.binding.clientStreamId,
  });
  if (translatedPayload === undefined) {
    return {
      payload: createUnboundInteractiveStreamResetPayload(dataFrameHeader.streamId),
      respondToCurrentPeer: true,
    };
  }

  return {
    payload: translatedPayload,
    targetConnectionSessionId: route.binding.clientSessionId,
  };
}

function createReleasedInteractiveStreamResetPayload(binding: ClientStreamBinding): string {
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

function createBootstrapDisconnectedStreamResetPayload(binding: ClientStreamBinding): string {
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

async function notifyConnectionPeerOfReleasedInteractiveStreams(input: {
  relayCoordinator: TunnelRelayCoordinator;
  releasedBindings: ClientStreamBinding[];
  sandboxInstanceId: string;
  toPayload?: (binding: ClientStreamBinding) => string;
}): Promise<void> {
  if (input.releasedBindings.length === 0) {
    return;
  }

  await Promise.all(
    input.releasedBindings.map((binding: ClientStreamBinding) =>
      input.relayCoordinator.forwardPeerMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        fromSide: "bootstrap",
        payload: (input.toPayload ?? createReleasedInteractiveStreamResetPayload)(binding),
        targetSessionId: binding.clientSessionId,
      }),
    ),
  );
}

async function notifyBootstrapPeerOfReleasedInteractiveStreams(input: {
  relayCoordinator: TunnelRelayCoordinator;
  releasedBindings: ClientStreamBinding[];
  sandboxInstanceId: string;
}): Promise<void> {
  if (input.releasedBindings.length === 0) {
    return;
  }

  await Promise.all(
    input.releasedBindings.map((binding: ClientStreamBinding) =>
      input.relayCoordinator.forwardPeerMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        fromSide: "connection",
        payload: createStreamClosePayload(binding),
      }),
    ),
  );
}

async function handleTunnelWebSocketMessage(input: {
  clientSessionId: string;
  currentSocket: Pick<WSContext, "close" | "send">;
  interactiveStreamRouter: InteractiveStreamRouter;
  payload: string | ArrayBuffer;
  relayCoordinator: TunnelRelayCoordinator;
  sandboxInstanceId: string;
  sourcePeerSide: RelayPeerSide;
}): Promise<void> {
  let routedMessage: RoutedTunnelMessage = {
    payload: input.payload,
  };
  if (typeof input.payload === "string") {
    routedMessage =
      input.sourcePeerSide === "connection"
        ? await translateConnectionPayloadToBootstrap({
            clientSessionId: input.clientSessionId,
            interactiveStreamRouter: input.interactiveStreamRouter,
            payload: input.payload,
            sandboxInstanceId: input.sandboxInstanceId,
          })
        : await translateBootstrapPayloadToConnection({
            interactiveStreamRouter: input.interactiveStreamRouter,
            payload: input.payload,
            sandboxInstanceId: input.sandboxInstanceId,
          });
  } else {
    routedMessage =
      input.sourcePeerSide === "connection"
        ? await translateConnectionBinaryPayloadToBootstrap({
            clientSessionId: input.clientSessionId,
            interactiveStreamRouter: input.interactiveStreamRouter,
            payload: input.payload,
            sandboxInstanceId: input.sandboxInstanceId,
          })
        : await translateBootstrapBinaryPayloadToConnection({
            interactiveStreamRouter: input.interactiveStreamRouter,
            payload: input.payload,
            sandboxInstanceId: input.sandboxInstanceId,
          });
  }

  if (routedMessage.dropMessage === true) {
    return;
  }

  if (routedMessage.respondToCurrentPeer === true) {
    input.currentSocket.send(routedMessage.payload);
  } else {
    await input.relayCoordinator.forwardPeerMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      fromSide: input.sourcePeerSide,
      payload: routedMessage.payload,
      targetSessionId: routedMessage.targetConnectionSessionId,
    });
  }

  if (routedMessage.releaseInteractiveStream !== undefined) {
    await input.interactiveStreamRouter.closeInteractiveStream({
      sandboxInstanceId: input.sandboxInstanceId,
      clientSessionId: routedMessage.releaseInteractiveStream.clientSessionId,
      clientStreamId: routedMessage.releaseInteractiveStream.clientStreamId,
    });
  }
  if (routedMessage.notifyBootstrapPeerOfReleasedStream !== undefined) {
    await notifyBootstrapPeerOfReleasedInteractiveStreams({
      relayCoordinator: input.relayCoordinator,
      releasedBindings: [routedMessage.notifyBootstrapPeerOfReleasedStream],
      sandboxInstanceId: input.sandboxInstanceId,
    });
  }
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(`Unexpected non-Error throwable: ${String(error)}`);
}

function recordTunnelSessionError(input: {
  tunnelSessionSpan: Span | undefined;
  error: unknown;
  statusMessage: string;
}): void {
  if (input.tunnelSessionSpan === undefined) {
    return;
  }

  input.tunnelSessionSpan.recordException(normalizeError(input.error));
  input.tunnelSessionSpan.setStatus({
    code: SpanStatusCode.ERROR,
    message: input.statusMessage,
  });
}

function finalizeTunnelSession(input: {
  closeCode: number;
  closeReason: string;
  openedAtMs: number | undefined;
  peerSide: RelayPeerSide;
  relaySessionId: string;
  sandboxInstanceId: string;
  tokenKind: TokenKind;
  tunnelSessionSpan: Span | undefined;
}): void {
  const closeClassification = classifySandboxTunnelClose({
    closeCode: input.closeCode,
    closeReason: input.closeReason,
  });
  const durationMs = input.openedAtMs === undefined ? undefined : Date.now() - input.openedAtMs;
  const logData = {
    closeCode: input.closeCode,
    closeOutcome: closeClassification.outcome,
    closeReason: input.closeReason,
    durationMs,
    peerSide: input.peerSide,
    relaySessionId: input.relaySessionId,
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: input.tokenKind,
  };
  const logMessage =
    input.tokenKind === "bootstrap"
      ? closeClassification.logLevel === "info"
        ? "Sandbox bootstrap tunnel disconnected"
        : "Sandbox bootstrap tunnel disconnected unexpectedly"
      : closeClassification.logLevel === "info"
        ? "Sandbox connection peer detached"
        : "Sandbox connection peer detached unexpectedly";

  if (closeClassification.logLevel === "info") {
    logger.info(logData, logMessage);
  } else {
    logger.warn(logData, logMessage);
  }

  if (input.tunnelSessionSpan === undefined) {
    return;
  }

  input.tunnelSessionSpan.setAttributes({
    "mistle.sandbox.tunnel.close_code": input.closeCode,
    "mistle.sandbox.tunnel.close_outcome": closeClassification.outcome,
    "mistle.sandbox.tunnel.close_reason": input.closeReason,
    ...(durationMs === undefined
      ? {}
      : {
          "mistle.sandbox.tunnel.duration_ms": durationMs,
        }),
  });
  if (closeClassification.spanStatusCode === SpanStatusCode.ERROR) {
    const statusMessage =
      closeClassification.spanStatusMessage ??
      `Sandbox tunnel websocket closed with code ${String(input.closeCode)}.`;
    input.tunnelSessionSpan.setStatus({
      code: closeClassification.spanStatusCode,
      message: statusMessage,
    });
  }
  input.tunnelSessionSpan.end();
}

export function registerSandboxTunnelRoute(input: RegisterSandboxTunnelRouteInput): void {
  input.app.get(
    SandboxTunnelRoutePath,
    async (ctx, next) => {
      if (ctx.req.header("upgrade")?.toLowerCase() !== "websocket") {
        return ctx.json({ error: "Sandbox tunnel endpoint requires websocket upgrade." }, 400);
      }
      const requestedInstanceId = ctx.req.param("instanceId").trim();
      if (requestedInstanceId.length === 0) {
        return ctx.json({ error: "Sandbox instance id path param is required." }, 400);
      }

      const requestedToken = readRequestedTokenFromRequestUrl(new URL(ctx.req.url));
      if (requestedToken.kind === "missing") {
        return ctx.json({ error: "Sandbox auth token is required." }, 401);
      }
      if (requestedToken.kind === "ambiguous") {
        return ctx.json(
          {
            error:
              "Provide exactly one auth token query param: either 'bootstrap_token' or 'connect_token'.",
          },
          400,
        );
      }

      let verifiedTokenJti: string;
      let verifiedTokenKind: TokenKind;
      let verifiedTokenSandboxInstanceId: string;
      try {
        const verificationResult = await verifyRequestedToken({
          requestedToken,
          bootstrapTokenConfig: input.bootstrapTokenConfig,
          connectionTokenConfig: input.connectionTokenConfig,
        });
        verifiedTokenJti = verificationResult.tokenJti;
        verifiedTokenKind = verificationResult.tokenKind;
        verifiedTokenSandboxInstanceId = verificationResult.tokenSandboxInstanceId;
      } catch (error) {
        if (error instanceof BootstrapTokenError) {
          return ctx.json({ error: error.message }, 401);
        }
        if (error instanceof ConnectionTokenError) {
          return ctx.json({ error: error.message }, 401);
        }

        logger.error(
          {
            err: error,
            requestedTokenKind: requestedToken.kind,
            requestedInstanceId,
          },
          "Unexpected sandbox tunnel token verification failure",
        );
        return ctx.json({ error: "Sandbox tunnel token verification failed." }, 500);
      }

      if (verifiedTokenSandboxInstanceId !== requestedInstanceId) {
        return ctx.json(
          { error: "Sandbox tunnel token sandboxInstanceId claim does not match request path." },
          401,
        );
      }

      if (verifiedTokenKind === "connection") {
        const ownerResolution = await input.sandboxOwnerResolver.resolveOwner({
          sandboxInstanceId: requestedInstanceId,
        });
        if (ownerResolution.kind === "missing") {
          return ctx.json({ error: "Sandbox is not connected." }, 409);
        }
        if (ownerResolution.kind === "remote") {
          return ctx.json({ error: "Sandbox is connected to a different gateway node." }, 503);
        }
      }

      try {
        const inserted = await insertSandboxTunnelConnectAck({
          db: ctx.get("db"),
          tokenJti: verifiedTokenJti,
        });

        if (!inserted) {
          return ctx.json({ error: "Sandbox tunnel token has already been acknowledged." }, 409);
        }
      } catch (error) {
        logger.error(
          {
            err: error,
            tokenJti: verifiedTokenJti,
            tokenKind: verifiedTokenKind,
          },
          "Failed to persist sandbox tunnel token acknowledgement",
        );
        return ctx.json({ error: "Failed to acknowledge sandbox tunnel token." }, 500);
      }

      if (verifiedTokenKind === "bootstrap") {
        const sandboxRelaySessionId = typeid("dts").toString();
        try {
          const owner = await input.sandboxOwnerStore.claimOwner({
            sandboxInstanceId: requestedInstanceId,
            nodeId: input.gatewayNodeId,
            sessionId: sandboxRelaySessionId,
            ttlMs: OwnerLeaseTtlMs,
          });
          ctx.set("sandboxRelaySessionId", sandboxRelaySessionId);
          ctx.set("sandboxOwnerLeaseId", owner.leaseId);
        } catch (error) {
          logger.error(
            {
              err: error,
              sandboxInstanceId: requestedInstanceId,
            },
            "Failed to claim sandbox ownership for bootstrap websocket",
          );
          return ctx.json({ error: "Failed to claim sandbox ownership." }, 500);
        }
      }

      await next();
    },
    input.upgradeWebSocket(
      (ctx) => {
        const requestedInstanceId = ctx.req.param("instanceId");
        if (requestedInstanceId === undefined) {
          throw new Error("Sandbox tunnel websocket request is missing instanceId path parameter.");
        }

        const sandboxInstanceId = requestedInstanceId.trim();
        const requestedToken = readRequestedTokenFromRequestUrl(new URL(ctx.req.url));
        if (requestedToken.kind !== "bootstrap" && requestedToken.kind !== "connection") {
          throw new Error("Expected validated sandbox tunnel websocket request token.");
        }

        const sourcePeerSide = toSourcePeerSide(requestedToken.kind);
        const bootstrapRelaySessionId =
          requestedToken.kind === "bootstrap" ? ctx.get("sandboxRelaySessionId") : undefined;
        const bootstrapOwnerLeaseId =
          requestedToken.kind === "bootstrap" ? ctx.get("sandboxOwnerLeaseId") : undefined;
        const connectionRelaySessionId =
          requestedToken.kind === "connection" ? typeid("dts").toString() : undefined;
        if (requestedToken.kind === "bootstrap" && bootstrapRelaySessionId === undefined) {
          throw new Error("Expected sandbox relay session id for bootstrap websocket request.");
        }
        if (requestedToken.kind === "bootstrap" && bootstrapOwnerLeaseId === undefined) {
          throw new Error("Expected sandbox owner lease id for bootstrap websocket request.");
        }
        if (requestedToken.kind === "connection" && connectionRelaySessionId === undefined) {
          throw new Error("Expected sandbox relay session id for connection websocket request.");
        }
        let relayTarget: RelayTarget | undefined;
        let sandboxOwnerLeaseHeartbeatHandle:
          | ReturnType<SandboxOwnerLeaseHeartbeat["start"]>
          | undefined;
        let tunnelSessionSpan: Span | undefined;
        let tunnelOpenedAtMs: number | undefined;
        const relaySessionId =
          requestedToken.kind === "bootstrap" ? bootstrapRelaySessionId : connectionRelaySessionId;

        return {
          onOpen: (_event, ws) => {
            tunnelOpenedAtMs = Date.now();
            tunnelSessionSpan = TunnelLifecycleTracer.startSpan(
              getSandboxTunnelSessionSpanName({
                peerSide: sourcePeerSide,
              }),
              {
                attributes: getSandboxTunnelSessionAttributes({
                  sandboxInstanceId,
                  peerSide: sourcePeerSide,
                  tokenKind: requestedToken.kind,
                }),
              },
            );
            logger.info(
              {
                sandboxInstanceId,
                peerSide: sourcePeerSide,
                relaySessionId,
                tokenKind: requestedToken.kind,
                ...(requestedToken.kind === "bootstrap"
                  ? {
                      leaseId: bootstrapOwnerLeaseId,
                    }
                  : {}),
              },
              requestedToken.kind === "bootstrap"
                ? "Sandbox bootstrap tunnel connected"
                : "Sandbox connection peer attached",
            );

            relayTarget = input.relayCoordinator.attachPeer({
              sandboxInstanceId,
              side: sourcePeerSide,
              sessionId:
                requestedToken.kind === "bootstrap"
                  ? bootstrapRelaySessionId
                  : connectionRelaySessionId,
              socket: ws,
            });

            if (requestedToken.kind === "bootstrap") {
              const attachResult = input.tunnelSessionRegistry.attachBootstrapSession(relayTarget);
              void notifyConnectionPeerOfReleasedInteractiveStreams({
                relayCoordinator: input.relayCoordinator,
                releasedBindings: attachResult.releasedBindings,
                sandboxInstanceId,
              }).catch((error: unknown) => {
                recordTunnelSessionError({
                  tunnelSessionSpan,
                  error,
                  statusMessage:
                    "Failed notifying connection peer about released interactive streams.",
                });
                logger.error(
                  {
                    err: error,
                    sandboxInstanceId,
                  },
                  "Failed notifying connection peer about released interactive streams",
                );
                ws.close(
                  CloseCodes.INTERNAL_ERROR,
                  "Failed notifying connection peer about released interactive streams.",
                );
              });
              void markSandboxTunnelConnected({
                activeTunnelLeaseId: bootstrapOwnerLeaseId,
                db: ctx.get("db"),
                sandboxInstanceId,
              }).catch((error: unknown) => {
                recordTunnelSessionError({
                  tunnelSessionSpan,
                  error,
                  statusMessage: "Failed to persist sandbox tunnel connection.",
                });
                logger.error(
                  {
                    err: error,
                    sandboxInstanceId,
                  },
                  "Failed to persist sandbox tunnel connected timestamp",
                );
                ws.close(CloseCodes.INTERNAL_ERROR, "Failed to persist sandbox tunnel connection.");
              });

              sandboxOwnerLeaseHeartbeatHandle = input.sandboxOwnerLeaseHeartbeat.start({
                sandboxInstanceId,
                leaseId: bootstrapOwnerLeaseId,
                ttlMs: OwnerLeaseTtlMs,
                onLeaseRenewed: () => {
                  void markSandboxTunnelSeen({
                    activeTunnelLeaseId: bootstrapOwnerLeaseId,
                    db: ctx.get("db"),
                    sandboxInstanceId,
                  })
                    .then((updated: boolean) => {
                      if (updated) {
                        return;
                      }

                      logger.info(
                        {
                          leaseId: bootstrapOwnerLeaseId,
                          sandboxInstanceId,
                        },
                        "Skipped sandbox tunnel heartbeat update for stale bootstrap lease",
                      );
                    })
                    .catch((error: unknown) => {
                      logger.error(
                        {
                          err: error,
                          sandboxInstanceId,
                        },
                        "Failed to persist sandbox tunnel heartbeat timestamp",
                      );
                    });
                },
                onLeaseLost: () => {
                  logger.error(
                    {
                      sandboxInstanceId,
                      leaseId: bootstrapOwnerLeaseId,
                    },
                    "Lost sandbox ownership while bootstrap websocket was still connected",
                  );
                  tunnelSessionSpan?.addEvent("sandbox.tunnel.owner_lease.lost");
                  tunnelSessionSpan?.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: "Sandbox ownership lease could not be renewed.",
                  });
                  ws.close(
                    CloseCodes.INTERNAL_ERROR,
                    "Sandbox ownership lease could not be renewed.",
                  );
                },
              });
            }
          },
          onMessage: (event, ws) => {
            if (relayTarget === undefined) {
              ws.close(
                CloseCodes.INTERNAL_ERROR,
                "Sandbox tunnel relay target was not initialized for websocket connection.",
              );
              return;
            }

            if (!input.relayCoordinator.isCurrentPeer(relayTarget)) {
              return;
            }

            const payload = toForwardPayload(event.data);
            if (payload === undefined) {
              ws.close(CloseCodes.INTERNAL_ERROR, "Unsupported websocket message type.");
              return;
            }

            void handleTunnelWebSocketMessage({
              clientSessionId: relaySessionId,
              currentSocket: ws,
              interactiveStreamRouter: input.interactiveStreamRouter,
              payload,
              relayCoordinator: input.relayCoordinator,
              sandboxInstanceId,
              sourcePeerSide,
            }).catch((error: unknown) => {
              if (error instanceof TunnelProtocolViolationError) {
                logger.info(
                  {
                    instanceId: sandboxInstanceId,
                    sourceTokenKind: requestedToken.kind,
                  },
                  error.message,
                );
                ws.close(CloseCodes.PROTOCOL_ERROR, error.message);
                return;
              }

              recordTunnelSessionError({
                tunnelSessionSpan,
                error,
                statusMessage: "Failed handling sandbox tunnel websocket message.",
              });
              logger.error(
                {
                  err: error,
                  instanceId: sandboxInstanceId,
                  sourceTokenKind: requestedToken.kind,
                },
                "Failed handling sandbox tunnel websocket message",
              );
              ws.close(
                CloseCodes.INTERNAL_ERROR,
                "Failed handling sandbox tunnel websocket message.",
              );
            });
          },
          onClose: (event) => {
            sandboxOwnerLeaseHeartbeatHandle?.stop();
            if (requestedToken.kind === "bootstrap" && bootstrapOwnerLeaseId !== undefined) {
              void markSandboxTunnelDisconnected({
                activeTunnelLeaseId: bootstrapOwnerLeaseId,
                db: ctx.get("db"),
                sandboxInstanceId,
              })
                .then((updated: boolean) => {
                  if (updated) {
                    return;
                  }

                  logger.info(
                    {
                      leaseId: bootstrapOwnerLeaseId,
                      sandboxInstanceId,
                    },
                    "Skipped sandbox tunnel disconnected update for stale bootstrap lease",
                  );
                })
                .catch((error: unknown) => {
                  logger.error(
                    {
                      err: error,
                      sandboxInstanceId,
                    },
                    "Failed to persist sandbox tunnel disconnected timestamp",
                  );
                });
              void input.sandboxOwnerStore.releaseOwner({
                sandboxInstanceId,
                leaseId: bootstrapOwnerLeaseId,
              });
            }
            if (relayTarget !== undefined) {
              const currentRelayTarget = relayTarget;
              if (requestedToken.kind === "bootstrap") {
                const detachedBootstrapSession =
                  input.tunnelSessionRegistry.detachBootstrapSession(currentRelayTarget);
                input.relayCoordinator.detachPeerWithOptions({
                  target: currentRelayTarget,
                  notifyOppositePeer: false,
                });
                if (detachedBootstrapSession?.releasedBindings.length) {
                  void notifyConnectionPeerOfReleasedInteractiveStreams({
                    relayCoordinator: input.relayCoordinator,
                    releasedBindings: detachedBootstrapSession.releasedBindings,
                    sandboxInstanceId,
                    toPayload: createBootstrapDisconnectedStreamResetPayload,
                  }).catch((error: unknown) => {
                    logger.error(
                      {
                        err: error,
                        sandboxInstanceId,
                      },
                      "Failed notifying connection peer about disconnected interactive streams",
                    );
                  });
                }
              } else {
                void input.interactiveStreamRouter
                  .releaseClientSessionStreams({
                    sandboxInstanceId,
                    clientSessionId: relaySessionId,
                  })
                  .then((result) =>
                    notifyBootstrapPeerOfReleasedInteractiveStreams({
                      relayCoordinator: input.relayCoordinator,
                      releasedBindings: result.releasedBindings,
                      sandboxInstanceId,
                    }),
                  )
                  .catch((error: unknown) => {
                    logger.error(
                      {
                        err: error,
                        sandboxInstanceId,
                      },
                      "Failed forwarding stream.close during connection detach",
                    );
                  })
                  .finally(() => {
                    input.relayCoordinator.detachPeer(currentRelayTarget);
                  });
              }
            }
            finalizeTunnelSession({
              closeCode: event.code,
              closeReason: event.reason,
              openedAtMs: tunnelOpenedAtMs,
              peerSide: sourcePeerSide,
              relaySessionId,
              sandboxInstanceId,
              tokenKind: requestedToken.kind,
              tunnelSessionSpan,
            });
            tunnelSessionSpan = undefined;
          },
          onError: (_event, ws) => {
            const error = new Error("Sandbox tunnel websocket emitted an error event.");
            recordTunnelSessionError({
              tunnelSessionSpan,
              error,
              statusMessage: error.message,
            });
            logger.error(
              {
                err: error,
                peerSide: sourcePeerSide,
                relaySessionId,
                sandboxInstanceId,
                tokenKind: requestedToken.kind,
              },
              "Sandbox tunnel websocket emitted an error event",
            );
            ws.close(CloseCodes.INTERNAL_ERROR, error.message);
          },
        };
      },
      {
        onError: (error) => {
          logger.error(
            {
              err: error,
            },
            "Sandbox tunnel websocket error",
          );
        },
      },
    ),
  );
}
