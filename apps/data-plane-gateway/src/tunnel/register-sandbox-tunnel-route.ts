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
  parseStreamControlMessage,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import type { WSMessageReceive } from "hono/ws";
import { typeid } from "typeid-js";

import { logger } from "../logger.js";
import type { DataPlaneGatewayApp } from "../types.js";
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
import type { ClientStreamBinding, TunnelSessionRegistry } from "./tunnel-session/index.js";
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
} = {
  INTERNAL_ERROR: 1011,
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

function hasPTYExitEvent(message: StreamControlMessage): boolean {
  return message.type === "stream.event" && message.event.type === "pty.exit";
}

function hasPTYResizeSignal(message: StreamControlMessage): boolean {
  return message.type === "stream.signal" && message.signal.type === "pty.resize";
}

async function translateConnectionPayloadToBootstrap(input: {
  clientSessionId: string;
  interactiveStreamRouter: InteractiveStreamRouter;
  payload: string;
  sandboxInstanceId: string;
}): Promise<string> {
  const ptyStreamOpen = parsePTYStreamOpen(input.payload);
  if (ptyStreamOpen !== undefined) {
    const route = await input.interactiveStreamRouter.openInteractiveStream({
      sandboxInstanceId: input.sandboxInstanceId,
      channelKind: "pty",
      clientSessionId: input.clientSessionId,
      clientStreamId: ptyStreamOpen.streamId,
    });

    return replaceStreamId({
      message: ptyStreamOpen,
      streamId: route.binding.tunnelStreamId,
    });
  }

  const controlMessage = parseStreamControlMessage(input.payload);
  if (controlMessage === undefined) {
    return input.payload;
  }

  const route = await input.interactiveStreamRouter.findInteractiveStreamByClient({
    sandboxInstanceId: input.sandboxInstanceId,
    clientSessionId: input.clientSessionId,
    clientStreamId: controlMessage.streamId,
  });
  if (route === undefined || route.binding.channelKind !== "pty") {
    return input.payload;
  }

  if (controlMessage.type === "stream.signal") {
    if (!hasPTYResizeSignal(controlMessage)) {
      return input.payload;
    }

    return replaceStreamId({
      message: controlMessage,
      streamId: route.binding.tunnelStreamId,
    });
  }

  if (controlMessage.type === "stream.close") {
    await input.interactiveStreamRouter.closeInteractiveStream({
      sandboxInstanceId: input.sandboxInstanceId,
      clientSessionId: route.binding.clientSessionId,
      clientStreamId: route.binding.clientStreamId,
    });

    return replaceStreamId({
      message: controlMessage,
      streamId: route.binding.tunnelStreamId,
    });
  }

  return input.payload;
}

async function translateBootstrapPayloadToConnection(input: {
  interactiveStreamRouter: InteractiveStreamRouter;
  payload: string;
  sandboxInstanceId: string;
}): Promise<string> {
  const controlMessage = parseStreamControlMessage(input.payload);
  if (controlMessage === undefined) {
    return input.payload;
  }

  const route = await input.interactiveStreamRouter.findInteractiveStreamByTunnel({
    sandboxInstanceId: input.sandboxInstanceId,
    tunnelStreamId: controlMessage.streamId,
  });
  if (route === undefined || route.binding.channelKind !== "pty") {
    return input.payload;
  }

  if (
    controlMessage.type === "stream.open.error" ||
    controlMessage.type === "stream.reset" ||
    hasPTYExitEvent(controlMessage)
  ) {
    await input.interactiveStreamRouter.closeInteractiveStream({
      sandboxInstanceId: input.sandboxInstanceId,
      clientSessionId: route.binding.clientSessionId,
      clientStreamId: route.binding.clientStreamId,
    });
  }

  return replaceStreamId({
    message: controlMessage,
    streamId: route.binding.clientStreamId,
  });
}

function createStreamClosePayload(binding: ClientStreamBinding): string {
  return JSON.stringify({
    type: "stream.close",
    streamId: binding.tunnelStreamId,
  });
}

async function handleTunnelWebSocketMessage(input: {
  clientSessionId: string;
  interactiveStreamRouter: InteractiveStreamRouter;
  payload: string | ArrayBuffer;
  relayCoordinator: TunnelRelayCoordinator;
  sandboxInstanceId: string;
  sourcePeerSide: RelayPeerSide;
}): Promise<void> {
  let routedPayload = input.payload;
  if (typeof input.payload === "string") {
    routedPayload =
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
  }

  await input.relayCoordinator.forwardPeerMessage({
    sandboxInstanceId: input.sandboxInstanceId,
    fromSide: input.sourcePeerSide,
    payload: routedPayload,
  });
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
              input.tunnelSessionRegistry.attachBootstrapSession(relayTarget);
              void markSandboxTunnelConnected({
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
                    db: ctx.get("db"),
                    sandboxInstanceId,
                  }).catch((error: unknown) => {
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
              interactiveStreamRouter: input.interactiveStreamRouter,
              payload,
              relayCoordinator: input.relayCoordinator,
              sandboxInstanceId,
              sourcePeerSide,
            }).catch((error: unknown) => {
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
                db: ctx.get("db"),
                sandboxInstanceId,
              }).catch((error: unknown) => {
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
              let suppressOppositePeerNotification = false;
              if (requestedToken.kind === "bootstrap") {
                input.tunnelSessionRegistry.detachBootstrapSession(relayTarget);
              } else {
                const releasedBindings = input.tunnelSessionRegistry.releaseClientSessionBindings({
                  sandboxInstanceId,
                  clientSessionId: relaySessionId,
                });
                const ptyBindings = releasedBindings.filter(
                  (binding: ClientStreamBinding) => binding.channelKind === "pty",
                );
                suppressOppositePeerNotification = ptyBindings.length > 0;

                if (ptyBindings.length > 0) {
                  void Promise.all(
                    ptyBindings.map((binding: ClientStreamBinding) =>
                      input.relayCoordinator.forwardPeerMessage({
                        sandboxInstanceId,
                        fromSide: sourcePeerSide,
                        payload: createStreamClosePayload(binding),
                      }),
                    ),
                  ).catch((error: unknown) => {
                    logger.error(
                      {
                        err: error,
                        sandboxInstanceId,
                      },
                      "Failed forwarding PTY stream.close during connection detach",
                    );
                  });
                }
              }

              input.relayCoordinator.detachPeerWithOptions({
                target: relayTarget,
                notifyOppositePeer: !suppressOppositePeerNotification,
              });
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
