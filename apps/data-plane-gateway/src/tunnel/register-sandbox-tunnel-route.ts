import type { NodeWebSocket } from "@hono/node-ws";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import type { BootstrapTokenConfig } from "@mistle/gateway-tunnel-auth";
import type { Clock, Scheduler } from "@mistle/time";
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";

import { logger } from "../logger.js";
import { OWNER_LEASE_TTL_MS } from "../runtime-state/runtime-state-durations.js";
import type { SandboxRuntimeAttachmentStore } from "../runtime-state/sandbox-runtime-attachment-store.js";
import type { DataPlaneGatewayApp } from "../types.js";
import { SandboxTunnelWebSocketAdmission } from "./admission/sandbox-tunnel-websocket-admission.js";
import { ExecutionLeaseRepository } from "./execution-lease-repository.js";
import type { InteractiveStreamRouter } from "./gateway-forwarding/index.js";
import type { SandboxOwnerLeaseHeartbeat } from "./ownership/sandbox-owner-lease-heartbeat.js";
import type { SandboxOwnerResolver } from "./ownership/sandbox-owner-resolver.js";
import type { SandboxOwnerStore } from "./ownership/sandbox-owner-store.js";
import { TunnelProtocolTranslator } from "./protocol/tunnel-protocol-translator.js";
import type { TunnelRelayCoordinator } from "./relay-coordinator.js";
import { TunnelLivelinessRepository } from "./session/tunnel-liveliness-repository.js";
import { type AttachedTunnelPeer, TunnelSessionService } from "./session/tunnel-session-service.js";
import { getSandboxTunnelSessionAttributes, getSandboxTunnelSessionSpanName } from "./telemetry.js";
import { finalizeTunnelSession, recordTunnelSessionError } from "./tunnel-session-observability.js";
import type { TunnelSessionRegistry } from "./tunnel-session/index.js";
import {
  handleTunnelWebSocketMessage,
  toTunnelForwardPayload,
  TunnelProtocolViolationError,
} from "./tunnel-websocket-message-handler.js";
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
  sandboxRuntimeAttachmentStore: SandboxRuntimeAttachmentStore;
  clock: Clock;
  scheduler: Scheduler;
};

type TokenKind = "bootstrap" | "connection";

const CloseCodes: {
  INTERNAL_ERROR: number;
  PROTOCOL_ERROR: number;
} = {
  INTERNAL_ERROR: 1011,
  PROTOCOL_ERROR: 1008,
};
const TunnelLifecycleTracer = trace.getTracer("@mistle/data-plane-gateway");

function toSourcePeerSide(tokenKind: TokenKind): RelayPeerSide {
  return tokenKind;
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
  const executionLeaseRepository = new ExecutionLeaseRepository();
  const tunnelSessionService = new TunnelSessionService(
    input.gatewayNodeId,
    input.interactiveStreamRouter,
    input.relayCoordinator,
    input.tunnelSessionRegistry,
    input.sandboxOwnerStore,
    input.sandboxOwnerLeaseHeartbeat,
    input.sandboxRuntimeAttachmentStore,
    new TunnelLivelinessRepository(),
    input.clock,
    input.scheduler,
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
            logger.debug(
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
                onTransportUnhealthy: (failure) => {
                  tunnelSessionSpan?.addEvent("sandbox.tunnel.transport_health.lost");
                  tunnelSessionSpan?.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: failure.statusMessage,
                  });
                  ws.close(CloseCodes.INTERNAL_ERROR, failure.closeReason);
                },
                ownerLeaseTtlMs: OWNER_LEASE_TTL_MS,
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

            const payload = toTunnelForwardPayload(event.data);
            if (payload === undefined) {
              ws.close(CloseCodes.INTERNAL_ERROR, "Unsupported websocket message type.");
              return;
            }

            void handleTunnelWebSocketMessage({
              clientSessionId: relaySessionId,
              currentSocket: ws,
              db: ctx.get("db"),
              executionLeaseRepository,
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
