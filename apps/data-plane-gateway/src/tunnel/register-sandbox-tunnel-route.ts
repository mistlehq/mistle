import type { NodeWebSocket } from "@hono/node-ws";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import type { BootstrapTokenConfig } from "@mistle/gateway-tunnel-auth";
import type { Clock, Scheduler } from "@mistle/time";
import { SpanStatusCode, type Span } from "@opentelemetry/api";

import type { SandboxDeadlineLifecycleCoordinator } from "../deadlines/sandbox-deadline-lifecycle-coordinator.js";
import type { SandboxInstanceDeadlineService } from "../deadlines/sandbox-instance-deadline-service.js";
import { GatewayEgressTransportService } from "../egress/egress-transport-service.js";
import { SandboxEgressTokenService } from "../egress/sandbox-egress-token-service.js";
import { logger } from "../logger.js";
import { PortAccessTransportService } from "../publishing/port-access-transport.js";
import { PortsTargetAuthorizeService } from "../publishing/ports-target-authorize-service.js";
import type { ActiveBootstrapSessionStore } from "../runtime-state/active-bootstrap-session-store.js";
import { OWNER_LEASE_TTL_MS } from "../runtime-state/durations.js";
import type { SandboxKeepaliveStore } from "../runtime-state/sandbox-keepalive-store.js";
import type { SandboxPresenceStore } from "../runtime-state/sandbox-presence-store.js";
import type { SandboxRuntimeAttachmentStore } from "../runtime-state/sandbox-runtime-attachment-store.js";
import type { SandboxRuntimeReadinessStore } from "../runtime-state/sandbox-runtime-readiness-store.js";
import type { AsyncTaskTracker } from "../runtime/async-task-tracker.js";
import type { DataPlaneGatewayApp } from "../types.js";
import { SandboxTunnelWebSocketAdmission } from "./admission/sandbox-tunnel-websocket-admission.js";
import type { InteractiveStreamRouter } from "./gateway-forwarding/index.js";
import type { SandboxOperationIngressService } from "./operation-ingress/index.js";
import type { SandboxOwnerResolver } from "./ownership/sandbox-owner-resolver.js";
import { TunnelProtocolTranslator } from "./protocol/tunnel-protocol-translator.js";
import type { TunnelRelayCoordinator } from "./relay-coordinator.js";
import { SandboxKeepaliveRepository } from "./sandbox-keepalive-repository.js";
import { SandboxRuntimeReadinessRepository } from "./sandbox-runtime-readiness-repository.js";
import { type AttachedTunnelPeer, TunnelSessionService } from "./session/tunnel-session-service.js";
import { SandboxSigningRequestService } from "./signing/sandbox-signing-request-service.js";
import type { SandboxTelemetryIngressService } from "./telemetry-ingress/index.js";
import {
  getSandboxTunnelDeliveryCorrelationScope,
  startSandboxTunnelSessionSpan,
} from "./telemetry.js";
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
  sandboxSigningRequestService: SandboxSigningRequestService;
  sandboxEgressTokenService: SandboxEgressTokenService;
  portAccessTransportService: PortAccessTransportService;
  portsTargetAuthorizeService: PortsTargetAuthorizeService;
  interactiveStreamRouter: InteractiveStreamRouter;
  relayCoordinator: TunnelRelayCoordinator;
  tunnelSessionRegistry: TunnelSessionRegistry;
  sandboxOwnerResolver: SandboxOwnerResolver;
  sandboxKeepaliveStore: SandboxKeepaliveStore;
  sandboxRuntimeReadinessStore: SandboxRuntimeReadinessStore;
  sandboxPresenceStore: SandboxPresenceStore;
  sandboxRuntimeAttachmentStore: SandboxRuntimeAttachmentStore;
  activeBootstrapSessionStore: ActiveBootstrapSessionStore;
  sandboxInstanceDeadlineService: SandboxInstanceDeadlineService;
  sandboxDeadlineLifecycleCoordinator: SandboxDeadlineLifecycleCoordinator;
  operationIngressService: SandboxOperationIngressService;
  telemetryIngressService: SandboxTelemetryIngressService;
  sandboxTunnelTaskTracker: AsyncTaskTracker;
  gatewayEgressTransportService: GatewayEgressTransportService;
  allowRemoteOwnerConnections: boolean;
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
function toSourcePeerSide(tokenKind: TokenKind): RelayPeerSide {
  return tokenKind;
}

export function registerSandboxTunnelRoute(input: RegisterSandboxTunnelRouteInput): void {
  const tunnelWebSocketAdmission = new SandboxTunnelWebSocketAdmission({
    allowRemoteOwnerConnections: input.allowRemoteOwnerConnections,
    bootstrapTokenConfig: input.bootstrapTokenConfig,
    connectionTokenConfig: input.connectionTokenConfig,
    sandboxOwnerResolver: input.sandboxOwnerResolver,
  });
  const tunnelProtocolTranslator = new TunnelProtocolTranslator(
    input.interactiveStreamRouter,
    input.portsTargetAuthorizeService,
    input.portAccessTransportService,
  );
  const sandboxKeepaliveRepository = new SandboxKeepaliveRepository(
    input.sandboxKeepaliveStore,
    input.sandboxInstanceDeadlineService,
    input.activeBootstrapSessionStore,
    input.sandboxDeadlineLifecycleCoordinator,
    input.clock,
    input.gatewayNodeId,
  );
  const sandboxRuntimeReadinessRepository = new SandboxRuntimeReadinessRepository(
    input.sandboxRuntimeReadinessStore,
    input.activeBootstrapSessionStore,
    input.clock,
    input.gatewayNodeId,
  );
  const tunnelSessionService = new TunnelSessionService(
    input.gatewayNodeId,
    input.interactiveStreamRouter,
    input.relayCoordinator,
    input.tunnelSessionRegistry,
    input.sandboxPresenceStore,
    input.sandboxRuntimeAttachmentStore,
    input.sandboxInstanceDeadlineService,
    input.sandboxDeadlineLifecycleCoordinator,
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
        tables: ctx.get("tables"),
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
        const sourceTokenJti = admittedRequest.tokenJti;
        const testEnvironmentId = ctx.get("testEnvironmentId");
        const deliveryCorrelationScope = getSandboxTunnelDeliveryCorrelationScope({
          tokenKind: sourceTokenKind,
        });
        let attachedPeer: AttachedTunnelPeer | undefined;
        let tunnelSessionSpan: Span | undefined;
        let tunnelOpenedAtMs: number | undefined;
        const relaySessionId = admittedRequest.relaySessionId;

        return {
          onOpen: (_event, ws) => {
            tunnelOpenedAtMs = Date.now();
            tunnelSessionSpan = startSandboxTunnelSessionSpan({
              sandboxInstanceId,
              peerSide: sourcePeerSide,
              tokenKind: sourceTokenKind,
              relaySessionId,
              tokenJti: sourceTokenJti,
            });
            logger.debug(
              {
                eventName: "gateway.tunnel.opened",
                "mistle.delivery.correlation_scope": deliveryCorrelationScope,
                "mistle.sandbox.instance_id": sandboxInstanceId,
                "mistle.sandbox.tunnel.peer_side": sourcePeerSide,
                "mistle.sandbox.tunnel.token_kind": sourceTokenKind,
                "mistle.tunnel.relay_session_id": relaySessionId,
                ...(deliveryCorrelationScope !== "join_via_connection_token_jti"
                  ? {}
                  : { "mistle.connection.token_jti": sourceTokenJti }),
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

            try {
              if (admittedRequest.kind === "bootstrap") {
                attachedPeer = tunnelSessionService.attachBootstrapPeer({
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
                  onRoundTripTimeObserved: (roundTripTimeMs) => {
                    tunnelSessionSpan?.addEvent("gateway.tunnel.websocket_rtt", {
                      "mistle.sandbox.tunnel.websocket_rtt_ms": roundTripTimeMs,
                    });
                  },
                  ownerLeaseTtlMs: OWNER_LEASE_TTL_MS,
                  relaySessionId,
                  sandboxInstanceId,
                  socket: ws,
                  ...(testEnvironmentId === undefined ? {} : { testEnvironmentId }),
                });
                return;
              }

              attachedPeer = tunnelSessionService.attachConnectionPeer({
                onFatalError: (failure) => {
                  recordTunnelSessionError({
                    tunnelSessionSpan,
                    error: failure.error,
                    statusMessage: failure.statusMessage,
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
                onRoundTripTimeObserved: (roundTripTimeMs) => {
                  tunnelSessionSpan?.addEvent("gateway.tunnel.websocket_rtt", {
                    "mistle.sandbox.tunnel.websocket_rtt_ms": roundTripTimeMs,
                  });
                },
                relaySessionId,
                sandboxInstanceId,
                socket: ws,
                ...(testEnvironmentId === undefined ? {} : { testEnvironmentId }),
              });
            } catch (error) {
              recordTunnelSessionError({
                tunnelSessionSpan,
                error,
                statusMessage: "Failed to attach sandbox tunnel websocket session.",
              });
              ws.close(
                CloseCodes.INTERNAL_ERROR,
                "Failed to attach sandbox tunnel websocket session.",
              );
            }
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

            input.sandboxTunnelTaskTracker.track(
              (async () => {
                if (attachedPeer?.activationPromise !== undefined) {
                  await attachedPeer.activationPromise;

                  if (ws.readyState !== 1) {
                    return;
                  }
                  if (!input.relayCoordinator.isCurrentPeer(relayTarget)) {
                    return;
                  }
                }

                await handleTunnelWebSocketMessage({
                  ...(admittedRequest.kind === "bootstrap"
                    ? { bootstrapOwnerLeaseId: admittedRequest.ownerLeaseId }
                    : {}),
                  clientSessionId: relaySessionId,
                  currentSocket: ws,
                  db: ctx.get("db"),
                  gatewayEgressTransportService: input.gatewayEgressTransportService,
                  handleEgressTokenRequestDelivery: async (delivery) => {
                    const result =
                      await input.sandboxEgressTokenService.handleBootstrapTokenRequest({
                        db: ctx.get("db"),
                        request: delivery.message,
                        sandboxInstanceId,
                        sourceBootstrapSessionId: relaySessionId,
                      });
                    ws.send(JSON.stringify(result));
                  },
                  handleSigningDelivery: async (delivery) => {
                    const result =
                      await input.sandboxSigningRequestService.handleBootstrapSigningRequest({
                        liveSandboxInstanceId: sandboxInstanceId,
                        request: delivery.message,
                        ...(testEnvironmentId === undefined ? {} : { testEnvironmentId }),
                      });
                    ws.send(JSON.stringify(result));
                  },
                  sandboxKeepaliveRepository,
                  sandboxRuntimeReadinessRepository,
                  handleOperationDelivery: async (delivery) => {
                    await input.operationIngressService.handleDelivery({
                      db: ctx.get("db"),
                      delivery,
                      relaySessionId,
                      sandboxInstanceId,
                      sendControlMessage: (message) => {
                        ws.send(JSON.stringify(message));
                      },
                      tables: ctx.get("tables"),
                    });
                  },
                  handleTelemetryDelivery: async (delivery) => {
                    await input.telemetryIngressService.handleDelivery({
                      delivery,
                      relaySessionId,
                      sandboxInstanceId,
                      sendControlMessage: (message) => {
                        ws.send(JSON.stringify(message));
                      },
                    });
                  },
                  interactiveStreamRouter: input.interactiveStreamRouter,
                  payload,
                  relayCoordinator: input.relayCoordinator,
                  sandboxInstanceId,
                  sourcePeerSide,
                  tables: ctx.get("tables"),
                  ...(testEnvironmentId === undefined ? {} : { testEnvironmentId }),
                  tunnelProtocolTranslator,
                });
              })().catch((error: unknown) => {
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
              }),
            );
          },
          onClose: (event) => {
            if (attachedPeer !== undefined) {
              if (admittedRequest.kind === "bootstrap") {
                const closeTasks: Promise<void>[] = [];
                input.portAccessTransportService.rejectPendingStreamsForBootstrapSession({
                  sandboxInstanceId,
                  targetBootstrapSessionId: relaySessionId,
                });
                input.gatewayEgressTransportService.cancelStreamsForBootstrapSession({
                  sandboxInstanceId,
                  sourceBootstrapSessionId: relaySessionId,
                });
                const rejectedPendingAuthorizeRequests =
                  input.portsTargetAuthorizeService.rejectPendingRequestsForBootstrapSession({
                    sandboxInstanceId,
                    targetBootstrapSessionId: relaySessionId,
                  });
                if (rejectedPendingAuthorizeRequests.length > 0) {
                  closeTasks.push(
                    Promise.all(
                      rejectedPendingAuthorizeRequests.map(async (pendingRequest) => {
                        await input.relayCoordinator.forwardPeerMessage({
                          sandboxInstanceId,
                          fromSide: "bootstrap",
                          payload: JSON.stringify(pendingRequest.result),
                          targetSessionId: pendingRequest.targetConnectionSessionId,
                        });
                      }),
                    )
                      .then(() => {})
                      .catch((error: unknown) => {
                        logger.error(
                          {
                            err: error,
                            relaySessionId,
                            sandboxInstanceId,
                            tokenKind: sourceTokenKind,
                          },
                          "Failed rejecting pending ports target authorize requests",
                        );
                      }),
                  );
                }
                closeTasks.push(
                  Promise.resolve().then(() => {
                    input.operationIngressService.detachBootstrapSession({
                      relaySessionId,
                      sandboxInstanceId,
                    });
                  }),
                );
                closeTasks.push(
                  input.telemetryIngressService
                    .detachBootstrapSession({
                      relaySessionId,
                      sandboxInstanceId,
                    })
                    .catch((error: unknown) => {
                      logger.error(
                        {
                          err: error,
                          relaySessionId,
                          sandboxInstanceId,
                          tokenKind: sourceTokenKind,
                        },
                        "Failed detaching sandbox telemetry ingress session",
                      );
                    }),
                );
                closeTasks.push(
                  tunnelSessionService
                    .detachBootstrapPeer({
                      attachedPeer,
                      leaseId: admittedRequest.ownerLeaseId,
                      sandboxInstanceId,
                      ...(testEnvironmentId === undefined ? {} : { testEnvironmentId }),
                    })
                    .catch((error: unknown) => {
                      logger.error(
                        {
                          err: error,
                          relaySessionId,
                          sandboxInstanceId,
                          tokenKind: sourceTokenKind,
                        },
                        "Failed detaching sandbox bootstrap tunnel session",
                      );
                    }),
                );
                input.sandboxTunnelTaskTracker.track(Promise.all(closeTasks).then(() => {}));
              } else {
                input.portsTargetAuthorizeService.rejectPendingRequestsForConnection({
                  clientSessionId: relaySessionId,
                  sandboxInstanceId,
                });
                input.sandboxTunnelTaskTracker.track(
                  tunnelSessionService
                    .detachConnectionPeer({
                      attachedPeer,
                      sandboxInstanceId,
                    })
                    .catch((error: unknown) => {
                      logger.error(
                        {
                          err: error,
                          relaySessionId,
                          sandboxInstanceId,
                          tokenKind: sourceTokenKind,
                        },
                        "Failed detaching sandbox connection tunnel session",
                      );
                    }),
                );
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
              tokenJti: sourceTokenJti,
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
