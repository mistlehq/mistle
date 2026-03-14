import type { NodeWebSocket } from "@hono/node-ws";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import type { BootstrapTokenConfig } from "@mistle/gateway-tunnel-auth";
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import type { WSContext, WSMessageReceive } from "hono/ws";

import { logger } from "../logger.js";
import type { DataPlaneGatewayApp } from "../types.js";
import { SandboxTunnelWebSocketAdmission } from "./admission/sandbox-tunnel-websocket-admission.js";
import type { InteractiveStreamRouter } from "./gateway-forwarding/index.js";
import type { SandboxOwnerLeaseHeartbeat } from "./ownership/sandbox-owner-lease-heartbeat.js";
import type { SandboxOwnerResolver } from "./ownership/sandbox-owner-resolver.js";
import type { SandboxOwnerStore } from "./ownership/sandbox-owner-store.js";
import {
  TunnelProtocolTranslator,
  TunnelProtocolViolationError,
} from "./protocol/tunnel-protocol-translator.js";
import type { TunnelRelayCoordinator } from "./relay-coordinator.js";
import { TunnelLivelinessRepository } from "./session/tunnel-liveliness-repository.js";
import { type AttachedTunnelPeer, TunnelSessionService } from "./session/tunnel-session-service.js";
import {
  classifySandboxTunnelClose,
  getSandboxTunnelSessionAttributes,
  getSandboxTunnelSessionSpanName,
} from "./telemetry.js";
import { notifyBootstrapPeerOfReleasedInteractiveStreams } from "./tunnel-peer-notifier.js";
import type { TunnelSessionRegistry } from "./tunnel-session/index.js";
import type { RelayPeerSide } from "./types.js";

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

const CloseCodes: {
  INTERNAL_ERROR: number;
  PROTOCOL_ERROR: number;
} = {
  INTERNAL_ERROR: 1011,
  PROTOCOL_ERROR: 1008,
};
const OwnerLeaseTtlMs = 30_000;
const TunnelLifecycleTracer = trace.getTracer("@mistle/data-plane-gateway");

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

async function handleTunnelWebSocketMessage(input: {
  clientSessionId: string;
  currentSocket: Pick<WSContext, "close" | "send">;
  interactiveStreamRouter: InteractiveStreamRouter;
  payload: string | ArrayBuffer;
  relayCoordinator: TunnelRelayCoordinator;
  sandboxInstanceId: string;
  sourcePeerSide: RelayPeerSide;
  tunnelProtocolTranslator: TunnelProtocolTranslator;
}): Promise<void> {
  const translation = await input.tunnelProtocolTranslator.translateInboundMessage({
    clientSessionId: input.clientSessionId,
    payload: input.payload,
    sandboxInstanceId: input.sandboxInstanceId,
    sourcePeerSide: input.sourcePeerSide,
  });

  if (translation.delivery.kind === "drop") {
    return;
  }

  if (translation.delivery.kind === "respond") {
    input.currentSocket.send(translation.delivery.payload);
  } else {
    await input.relayCoordinator.forwardPeerMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      fromSide: input.sourcePeerSide,
      payload: translation.delivery.payload,
      targetSessionId: translation.delivery.targetConnectionSessionId,
    });
  }

  if (translation.releaseInteractiveStream !== undefined) {
    await input.interactiveStreamRouter.closeInteractiveStream({
      sandboxInstanceId: input.sandboxInstanceId,
      clientSessionId: translation.releaseInteractiveStream.clientSessionId,
      clientStreamId: translation.releaseInteractiveStream.clientStreamId,
    });
  }
  if (translation.notifyBootstrapPeerOfReleasedStream !== undefined) {
    await notifyBootstrapPeerOfReleasedInteractiveStreams({
      relayCoordinator: input.relayCoordinator,
      releasedBindings: [translation.notifyBootstrapPeerOfReleasedStream],
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
  const tunnelWebSocketAdmission = new SandboxTunnelWebSocketAdmission({
    bootstrapTokenConfig: input.bootstrapTokenConfig,
    connectionTokenConfig: input.connectionTokenConfig,
    gatewayNodeId: input.gatewayNodeId,
    sandboxOwnerResolver: input.sandboxOwnerResolver,
    sandboxOwnerStore: input.sandboxOwnerStore,
  });
  const tunnelProtocolTranslator = new TunnelProtocolTranslator(input.interactiveStreamRouter);
  const tunnelSessionService = new TunnelSessionService(
    input.interactiveStreamRouter,
    input.relayCoordinator,
    input.tunnelSessionRegistry,
    input.sandboxOwnerStore,
    input.sandboxOwnerLeaseHeartbeat,
    new TunnelLivelinessRepository(),
  );

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

      const admission = await tunnelWebSocketAdmission.admitRequest({
        db: ctx.get("db"),
        requestUrl: ctx.req.url,
        requestedInstanceId,
      });
      if (admission.kind === "rejected") {
        return ctx.json(
          { error: admission.rejection.error },
          { status: admission.rejection.status },
        );
      }
      ctx.set("sandboxTunnelAdmission", admission.request);

      await next();
    },
    input.upgradeWebSocket(
      (ctx) => {
        const requestedInstanceId = ctx.req.param("instanceId");
        if (requestedInstanceId === undefined) {
          throw new Error("Sandbox tunnel websocket request is missing instanceId path parameter.");
        }

        const admittedRequest = ctx.get("sandboxTunnelAdmission");
        if (admittedRequest === undefined) {
          throw new Error("Expected validated sandbox tunnel websocket request admission.");
        }

        const sandboxInstanceId = admittedRequest.sandboxInstanceId;
        const sourceTokenKind: TokenKind = admittedRequest.kind;
        const sourcePeerSide = toSourcePeerSide(sourceTokenKind);
        let attachedPeer: AttachedTunnelPeer | undefined;
        let tunnelSessionSpan: Span | undefined;
        let tunnelOpenedAtMs: number | undefined;
        const relaySessionId = admittedRequest.relaySessionId;

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
                  tokenKind: sourceTokenKind,
                }),
              },
            );
            logger.info(
              {
                sandboxInstanceId,
                peerSide: sourcePeerSide,
                relaySessionId,
                tokenKind: sourceTokenKind,
                ...(admittedRequest.kind === "bootstrap"
                  ? {
                      leaseId: admittedRequest.ownerLeaseId,
                    }
                  : {}),
              },
              admittedRequest.kind === "bootstrap"
                ? "Sandbox bootstrap tunnel connected"
                : "Sandbox connection peer attached",
            );

            if (admittedRequest.kind === "bootstrap") {
              attachedPeer = tunnelSessionService.attachBootstrapPeer({
                db: ctx.get("db"),
                leaseId: admittedRequest.ownerLeaseId,
                onFatalError: (failure) => {
                  recordTunnelSessionError({
                    tunnelSessionSpan,
                    error: failure.error,
                    statusMessage: failure.statusMessage,
                  });
                  ws.close(CloseCodes.INTERNAL_ERROR, failure.closeReason);
                },
                onLeaseLost: (failure) => {
                  tunnelSessionSpan?.addEvent("sandbox.tunnel.owner_lease.lost");
                  tunnelSessionSpan?.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: failure.statusMessage,
                  });
                  ws.close(CloseCodes.INTERNAL_ERROR, failure.closeReason);
                },
                ownerLeaseTtlMs: OwnerLeaseTtlMs,
                relaySessionId,
                sandboxInstanceId,
                socket: ws,
              });
              return;
            }

            attachedPeer = tunnelSessionService.attachConnectionPeer({
              relaySessionId,
              sandboxInstanceId,
              socket: ws,
            });
          },
          onMessage: (event, ws) => {
            const relayTarget = attachedPeer?.relayTarget;
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
              tunnelProtocolTranslator,
            }).catch((error: unknown) => {
              if (error instanceof TunnelProtocolViolationError) {
                logger.info(
                  {
                    instanceId: sandboxInstanceId,
                    sourceTokenKind,
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
                  sourceTokenKind,
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
            if (attachedPeer !== undefined) {
              if (admittedRequest.kind === "bootstrap") {
                void tunnelSessionService.detachBootstrapPeer({
                  attachedPeer,
                  db: ctx.get("db"),
                  leaseId: admittedRequest.ownerLeaseId,
                  sandboxInstanceId,
                });
              } else {
                void tunnelSessionService.detachConnectionPeer({
                  attachedPeer,
                  sandboxInstanceId,
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
              tokenKind: sourceTokenKind,
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
                tokenKind: sourceTokenKind,
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
