import type { Clock, Scheduler, TimerHandle } from "@mistle/time";
import { WebSocket } from "ws";

import type { SandboxDeadlineLifecycleCoordinator } from "../../deadlines/sandbox-deadline-lifecycle-coordinator.js";
import type { SandboxInstanceDeadlineService } from "../../deadlines/sandbox-instance-deadline-service.js";
import { logger } from "../../logger.js";
import {
  BOOTSTRAP_WEBSOCKET_MAX_CONSECUTIVE_MISSED_PONGS,
  ATTACHMENT_TTL_MS,
  OWNER_LEASE_RENEW_INTERVAL_MS,
  PRESENCE_LEASE_RENEW_INTERVAL_MS,
  PRESENCE_LEASE_TTL_MS,
  WEBSOCKET_PING_INTERVAL_MS,
  WEBSOCKET_PONG_TIMEOUT_MS,
} from "../../runtime-state/durations.js";
import type { SandboxPresenceStore } from "../../runtime-state/sandbox-presence-store.js";
import type { SandboxRuntimeAttachmentStore } from "../../runtime-state/sandbox-runtime-attachment-store.js";
import type { InteractiveStreamRouter } from "../gateway-forwarding/index.js";
import type { TunnelRelayCoordinator } from "../relay-coordinator.js";
import {
  notifyBootstrapPeerOfReleasedInteractiveStreams,
  notifyConnectionPeerOfBootstrapDisconnect,
  notifyConnectionPeerOfReleasedInteractiveStreams,
} from "../tunnel-peer-notifier.js";
import type { TunnelSessionRegistry } from "../tunnel-session/index.js";
import type { RelayPeerSocket, RelayTarget } from "../types.js";
import {
  startWebSocketHealthMonitor,
  type WebSocketHealthHandle,
  type WebSocketHealthSnapshot,
} from "./websocket-health-monitor.js";

const ConnectionPresenceLeaseSource = "dashboard";

type LeaseRenewalHandle = {
  stop: () => void;
};

export const BootstrapTunnelCloseCauses = {
  GATEWAY_ATTACH_FATAL_ERROR: "gateway_attach_fatal_error",
  GATEWAY_HEALTH_MISSED_PONGS: "gateway_health_missed_pongs",
  GATEWAY_MESSAGE_HANDLER_ERROR: "gateway_message_handler_error",
  GATEWAY_OWNER_LEASE_LOST: "gateway_owner_lease_lost",
  GATEWAY_PRESENCE_DEADLINE_FAILED: "gateway_presence_deadline_failed",
  GATEWAY_PROTOCOL_ERROR: "gateway_protocol_error",
  GATEWAY_UNSUPPORTED_MESSAGE_TYPE: "gateway_unsupported_message_type",
  PEER_CLOSE_FRAME: "peer_close_frame",
  TRANSPORT_ABNORMAL_CLOSE: "transport_abnormal_close",
  TRANSPORT_ERROR: "transport_error",
} as const;

export type BootstrapTunnelCloseCause =
  (typeof BootstrapTunnelCloseCauses)[keyof typeof BootstrapTunnelCloseCauses];

export type BootstrapTunnelCloseContext = {
  cause: BootstrapTunnelCloseCause;
  gatewayInitiated: boolean;
  initiatedAtMs?: number;
  reason: string;
};

export type BootstrapTunnelCloseDiagnostics = {
  closeCause: BootstrapTunnelCloseCause;
  gatewayInitiatedClose: boolean;
  closeInitiatedAtMs: number | null;
  closeCauseReason: string;
  socketAgeMs: number;
  health: WebSocketHealthSnapshot | null;
};

/**
 * Captures the live relay target for an attached websocket peer plus any
 * teardown handle that must be stopped when the peer disconnects.
 */
export type AttachedTunnelPeer = {
  activationPromise?: Promise<void>;
  bootstrapCloseContext?: BootstrapTunnelCloseContext;
  openedAtMs?: number;
  relayTarget: RelayTarget;
  leaseHeartbeatHandle?: LeaseRenewalHandle;
  presenceLeaseRenewalHandle?: {
    stop: () => void;
  };
  websocketHealthHandle?: WebSocketHealthHandle;
};

/**
 * Describes a fatal bootstrap attach side effect failure that should terminate
 * the websocket after the caller records any session-scoped telemetry.
 */
export type TunnelSessionFatalError = {
  closeReason: string;
  error: unknown;
  statusMessage: string;
};

/**
 * Describes a lost bootstrap owner lease that should terminate the websocket.
 */
export type TunnelSessionLeaseLost = {
  closeReason: string;
  statusMessage: string;
};

/**
 * Describes an unhealthy bootstrap websocket that should be closed.
 */
export type TunnelSessionTransportUnhealthy = {
  closeReason: string;
  statusMessage: string;
};

export class TunnelSessionService {
  private readonly bootstrapCloseContextsBySessionId = new Map<
    string,
    BootstrapTunnelCloseContext
  >();

  public constructor(
    private readonly gatewayNodeId: string,
    private readonly interactiveStreamRouter: InteractiveStreamRouter,
    private readonly relayCoordinator: TunnelRelayCoordinator,
    private readonly tunnelSessionRegistry: TunnelSessionRegistry,
    private readonly sandboxPresenceStore: SandboxPresenceStore,
    private readonly sandboxRuntimeAttachmentStore: SandboxRuntimeAttachmentStore,
    private readonly sandboxInstanceDeadlineService: SandboxInstanceDeadlineService,
    private readonly sandboxDeadlineLifecycleCoordinator: SandboxDeadlineLifecycleCoordinator,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
  ) {}

  /**
   * Attaches the bootstrap websocket as the owner-local tunnel peer and starts
   * the lease heartbeat and liveliness persistence side effects for that lease.
   */
  public attachBootstrapPeer(input: {
    leaseId: string;
    onFatalError: (failure: TunnelSessionFatalError) => void;
    onLeaseLost: (failure: TunnelSessionLeaseLost) => void;
    onRoundTripTimeObserved?: (roundTripTimeMs: number) => void;
    onTransportUnhealthy: (failure: TunnelSessionTransportUnhealthy) => void;
    openedAtMs?: number;
    ownerLeaseTtlMs: number;
    relaySessionId: string;
    sandboxInstanceId: string;
    socket: RelayPeerSocket;
    testEnvironmentId?: string;
  }): AttachedTunnelPeer {
    const relayTarget = this.relayCoordinator.attachPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: "bootstrap",
      sessionId: input.relaySessionId,
      socket: input.socket,
    });
    const attachResult = this.tunnelSessionRegistry.attachBootstrapSession(relayTarget);

    const runtimeAttachmentAttachedAtMs = this.clock.nowMs();
    const openedAtMs = input.openedAtMs ?? runtimeAttachmentAttachedAtMs;
    let websocketHealthHandle: WebSocketHealthHandle | undefined;

    const attachedPeer: AttachedTunnelPeer = {
      openedAtMs,
      relayTarget,
    };

    try {
      websocketHealthHandle = startWebSocketHealthMonitor({
        clock: this.clock,
        socketKind: "bootstrap",
        tokenKind: "bootstrap",
        socket: input.socket,
        scheduler: this.scheduler,
        pingIntervalMs: WEBSOCKET_PING_INTERVAL_MS,
        pongTimeoutMs: WEBSOCKET_PONG_TIMEOUT_MS,
        maxConsecutiveMissedPongs: BOOTSTRAP_WEBSOCKET_MAX_CONSECUTIVE_MISSED_PONGS,
        onMissedPong: ({ consecutiveMissedPongs, lastPongAgeMs, maxConsecutiveMissedPongs }) => {
          logger.warn(
            {
              sandboxInstanceId: input.sandboxInstanceId,
              leaseId: input.leaseId,
              consecutiveMissedPongs,
              lastPongAgeMs,
              maxConsecutiveMissedPongs,
            },
            "Bootstrap websocket missed pong health check",
          );
          void this.sandboxDeadlineLifecycleCoordinator
            .enqueue({
              sandboxInstanceId: input.sandboxInstanceId,
              operation: async () => {
                if (!this.relayCoordinator.isCurrentPeer(relayTarget)) {
                  return;
                }

                await this.sandboxInstanceDeadlineService.handleBootstrapDegraded({
                  sandboxInstanceId: input.sandboxInstanceId,
                  ownerLeaseId: input.leaseId,
                  ...(input.testEnvironmentId === undefined
                    ? {}
                    : { testEnvironmentId: input.testEnvironmentId }),
                });
              },
            })
            .catch((error: unknown) => {
              logger.warn(
                {
                  err: error,
                  sandboxInstanceId: input.sandboxInstanceId,
                  leaseId: input.leaseId,
                },
                "Failed to mark bootstrap websocket as degraded after missed pong",
              );
            });
        },
        onRecovered: ({ consecutiveMissedPongs, lastPongAgeMs }) => {
          logger.info(
            {
              sandboxInstanceId: input.sandboxInstanceId,
              leaseId: input.leaseId,
              consecutiveMissedPongs,
              lastPongAgeMs,
            },
            "Bootstrap websocket recovered after missed pong health check",
          );
          void this.sandboxDeadlineLifecycleCoordinator
            .enqueue({
              sandboxInstanceId: input.sandboxInstanceId,
              operation: async () => {
                if (!this.relayCoordinator.isCurrentPeer(relayTarget)) {
                  return;
                }

                await this.sandboxInstanceDeadlineService.handleBootstrapRecovered({
                  sandboxInstanceId: input.sandboxInstanceId,
                  ownerLeaseId: input.leaseId,
                  ...(input.testEnvironmentId === undefined
                    ? {}
                    : { testEnvironmentId: input.testEnvironmentId }),
                });
              },
            })
            .catch((error: unknown) => {
              logger.warn(
                {
                  err: error,
                  sandboxInstanceId: input.sandboxInstanceId,
                  leaseId: input.leaseId,
                },
                "Failed to mark bootstrap websocket as recovered after pong health check",
              );
            });
        },
        onUnhealthy: () => {
          this.recordBootstrapCloseContext({
            attachedPeer,
            cause: BootstrapTunnelCloseCauses.GATEWAY_HEALTH_MISSED_PONGS,
            gatewayInitiated: true,
            reason: "Sandbox bootstrap websocket stopped responding to ping.",
          });
          logger.error(
            {
              eventName: "gateway.bootstrap.close.initiated",
              ...this.bootstrapCloseDiagnostics(attachedPeer),
              sandboxInstanceId: input.sandboxInstanceId,
              leaseId: input.leaseId,
              maxConsecutiveMissedPongs: BOOTSTRAP_WEBSOCKET_MAX_CONSECUTIVE_MISSED_PONGS,
            },
            "Bootstrap websocket stopped responding to ping/pong health checks",
          );
          input.onTransportUnhealthy({
            closeReason: "Sandbox bootstrap websocket stopped responding to ping.",
            statusMessage: "Sandbox bootstrap websocket stopped responding to ping.",
          });
        },
        ...(input.onRoundTripTimeObserved === undefined
          ? {}
          : { onRoundTripTimeObserved: input.onRoundTripTimeObserved }),
      });
    } catch (error) {
      this.recordBootstrapCloseContext({
        attachedPeer,
        cause: BootstrapTunnelCloseCauses.GATEWAY_ATTACH_FATAL_ERROR,
        gatewayInitiated: true,
        reason: "Failed to initialize bootstrap websocket health checks.",
      });
      logger.error(
        {
          err: error,
          eventName: "gateway.bootstrap.close.initiated",
          ...this.bootstrapCloseDiagnostics(attachedPeer),
          sandboxInstanceId: input.sandboxInstanceId,
        },
        "Failed to initialize bootstrap websocket health checks",
      );
      input.onFatalError({
        closeReason: "Failed to initialize bootstrap websocket health checks.",
        error,
        statusMessage: "Failed to initialize bootstrap websocket health checks.",
      });
    }

    attachedPeer.activationPromise = this.activateBootstrapAttachment({
      attachedAtMs: runtimeAttachmentAttachedAtMs,
      attachedPeer,
      leaseId: input.leaseId,
      onFatalError: input.onFatalError,
      onLeaseLost: input.onLeaseLost,
      ownerLeaseTtlMs: input.ownerLeaseTtlMs,
      relaySessionId: input.relaySessionId,
      relayTarget,
      sandboxInstanceId: input.sandboxInstanceId,
      socket: input.socket,
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
    });

    void notifyConnectionPeerOfReleasedInteractiveStreams({
      relayCoordinator: this.relayCoordinator,
      releasedBindings: attachResult.releasedBindings,
      sandboxInstanceId: input.sandboxInstanceId,
    }).catch((error: unknown) => {
      this.recordBootstrapCloseContext({
        attachedPeer,
        cause: BootstrapTunnelCloseCauses.GATEWAY_ATTACH_FATAL_ERROR,
        gatewayInitiated: true,
        reason: "Failed notifying connection peer about released interactive streams.",
      });
      logger.error(
        {
          err: error,
          eventName: "gateway.bootstrap.close.initiated",
          ...this.bootstrapCloseDiagnostics(attachedPeer),
          sandboxInstanceId: input.sandboxInstanceId,
        },
        "Failed notifying connection peer about released interactive streams",
      );
      input.onFatalError({
        closeReason: "Failed notifying connection peer about released interactive streams.",
        error,
        statusMessage: "Failed notifying connection peer about released interactive streams.",
      });
    });

    if (websocketHealthHandle !== undefined) {
      attachedPeer.websocketHealthHandle = websocketHealthHandle;
    }
    this.tunnelSessionRegistry.setBootstrapSessionAvailability({
      sandboxInstanceId: input.sandboxInstanceId,
      sessionId: relayTarget.sessionId,
      isAvailable: () =>
        input.socket.readyState === WebSocket.OPEN &&
        (attachedPeer.websocketHealthHandle?.isHealthy() ?? true),
    });

    return attachedPeer;
  }

  /**
   * Attaches a connection websocket as a relay peer for the target sandbox.
   */
  public attachConnectionPeer(input: {
    onFatalError: (failure: TunnelSessionFatalError) => void;
    onRoundTripTimeObserved?: (roundTripTimeMs: number) => void;
    onTransportUnhealthy: (failure: TunnelSessionTransportUnhealthy) => void;
    relaySessionId: string;
    sandboxInstanceId: string;
    socket: RelayPeerSocket;
    testEnvironmentId?: string;
  }): AttachedTunnelPeer {
    const relayTarget = this.relayCoordinator.attachPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: "connection",
      sessionId: input.relaySessionId,
      socket: input.socket,
    });

    let websocketHealthHandle: WebSocketHealthHandle | undefined;
    let presenceLeaseRenewalHandle:
      | {
          stop: () => void;
        }
      | undefined;
    try {
      websocketHealthHandle = startWebSocketHealthMonitor({
        clock: this.clock,
        socketKind: "connection",
        tokenKind: "connection",
        socket: input.socket,
        scheduler: this.scheduler,
        pingIntervalMs: WEBSOCKET_PING_INTERVAL_MS,
        pongTimeoutMs: WEBSOCKET_PONG_TIMEOUT_MS,
        onUnhealthy: () => {
          logger.error(
            {
              sandboxInstanceId: input.sandboxInstanceId,
              relaySessionId: input.relaySessionId,
            },
            "Connection websocket stopped responding to ping/pong health checks",
          );
          presenceLeaseRenewalHandle?.stop();
          input.onTransportUnhealthy({
            closeReason: "Sandbox connection websocket stopped responding to ping.",
            statusMessage: "Sandbox connection websocket stopped responding to ping.",
          });
        },
        ...(input.onRoundTripTimeObserved === undefined
          ? {}
          : { onRoundTripTimeObserved: input.onRoundTripTimeObserved }),
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          sandboxInstanceId: input.sandboxInstanceId,
          relaySessionId: input.relaySessionId,
        },
        "Failed to initialize connection websocket health checks",
      );
      input.onFatalError({
        closeReason: "Failed to initialize connection websocket health checks.",
        error,
        statusMessage: "Failed to initialize connection websocket health checks.",
      });
    }

    presenceLeaseRenewalHandle = this.startPresenceLeaseRenewal({
      leaseId: input.relaySessionId,
      onLeaseTouched: async () => {
        await this.sandboxDeadlineLifecycleCoordinator
          .enqueue({
            sandboxInstanceId: input.sandboxInstanceId,
            operation: async () => {
              const activeSession = await this.sandboxRuntimeAttachmentStore.getAttachment({
                sandboxInstanceId: input.sandboxInstanceId,
                nowMs: this.clock.nowMs(),
              });
              if (activeSession === null) {
                return;
              }

              await this.sandboxInstanceDeadlineService.touchIdleDeadline({
                sandboxInstanceId: input.sandboxInstanceId,
                ownerLeaseId: activeSession.ownerLeaseId,
                ...(input.testEnvironmentId === undefined
                  ? {}
                  : { testEnvironmentId: input.testEnvironmentId }),
              });
            },
          })
          .catch((error: unknown) => {
            logger.warn(
              {
                err: error,
                sandboxInstanceId: input.sandboxInstanceId,
                relaySessionId: input.relaySessionId,
              },
              "Failed to refresh sandbox idle deadline after connection presence renewal",
            );
          });
      },
      onTouchFailed: (error) => {
        logger.error(
          {
            err: error,
            sandboxInstanceId: input.sandboxInstanceId,
            relaySessionId: input.relaySessionId,
          },
          "Failed to persist sandbox presence lease for connection peer",
        );
        void this.closeCurrentBootstrapPeer({
          sandboxInstanceId: input.sandboxInstanceId,
          cause: BootstrapTunnelCloseCauses.GATEWAY_PRESENCE_DEADLINE_FAILED,
          closeReason: "Failed to persist sandbox presence lease.",
          statusMessage: "Failed to persist sandbox presence lease.",
        }).catch((closeError: unknown) => {
          logger.error(
            {
              err: closeError,
              sandboxInstanceId: input.sandboxInstanceId,
            },
            "Failed to close bootstrap websocket after presence deadline failure",
          );
        });
      },
      relaySessionId: input.relaySessionId,
      sandboxInstanceId: input.sandboxInstanceId,
      socket: input.socket,
    });

    return {
      ...(presenceLeaseRenewalHandle === undefined ? {} : { presenceLeaseRenewalHandle }),
      relayTarget,
      ...(websocketHealthHandle === undefined ? {} : { websocketHealthHandle }),
    };
  }

  /**
   * Detaches the bootstrap peer, stops lease renewal, persists disconnection,
   * releases owner-local bindings, and notifies any affected connection peers.
   */
  public async detachBootstrapPeer(input: {
    attachedPeer: AttachedTunnelPeer;
    closeCode?: number;
    closeReason?: string;
    leaseId: string;
    sandboxInstanceId: string;
    testEnvironmentId?: string;
  }): Promise<void> {
    input.attachedPeer.leaseHeartbeatHandle?.stop();
    input.attachedPeer.websocketHealthHandle?.stop();
    this.tunnelSessionRegistry.setBootstrapSessionAvailability({
      sandboxInstanceId: input.sandboxInstanceId,
      sessionId: input.attachedPeer.relayTarget.sessionId,
      isAvailable: () => false,
    });

    if (!this.relayCoordinator.isCurrentPeer(input.attachedPeer.relayTarget)) {
      logger.info(
        {
          eventName: "gateway.bootstrap.detach.skipped",
          ...this.bootstrapCloseDiagnostics(input.attachedPeer, {
            closeCode: input.closeCode,
            closeReason: input.closeReason,
          }),
          closeCode: input.closeCode,
          closeReason: input.closeReason,
          ownerLeaseId: input.leaseId,
          relaySessionId: input.attachedPeer.relayTarget.sessionId,
          sandboxInstanceId: input.sandboxInstanceId,
        },
        "Skipped bootstrap detach side effects because peer was no longer current.",
      );
      this.relayCoordinator.detachPeerWithOptions({
        target: input.attachedPeer.relayTarget,
        notifyOppositePeer: false,
      });
      this.tunnelSessionRegistry.clearBootstrapSessionAvailability({
        sandboxInstanceId: input.sandboxInstanceId,
        sessionId: input.attachedPeer.relayTarget.sessionId,
      });
      this.bootstrapCloseContextsBySessionId.delete(input.attachedPeer.relayTarget.sessionId);
      return;
    }

    await this.sandboxDeadlineLifecycleCoordinator.enqueue({
      sandboxInstanceId: input.sandboxInstanceId,
      operation: async () => {
        if (!this.relayCoordinator.isCurrentPeer(input.attachedPeer.relayTarget)) {
          logger.info(
            {
              eventName: "gateway.bootstrap.detach.skipped",
              ...this.bootstrapCloseDiagnostics(input.attachedPeer, {
                closeCode: input.closeCode,
                closeReason: input.closeReason,
              }),
              closeCode: input.closeCode,
              closeReason: input.closeReason,
              ownerLeaseId: input.leaseId,
              relaySessionId: input.attachedPeer.relayTarget.sessionId,
              sandboxInstanceId: input.sandboxInstanceId,
            },
            "Skipped bootstrap detach side effects because peer changed before deadline update.",
          );
          return;
        }

        const previousAttachment = await this.sandboxRuntimeAttachmentStore.getAttachment({
          sandboxInstanceId: input.sandboxInstanceId,
          nowMs: this.clock.nowMs(),
        });
        await this.sandboxRuntimeAttachmentStore.clearAttachment({
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
        });
        await this.sandboxInstanceDeadlineService.handleBootstrapDisconnect({
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
          ...(input.testEnvironmentId === undefined
            ? {}
            : { testEnvironmentId: input.testEnvironmentId }),
        });
        const nextAttachment = await this.sandboxRuntimeAttachmentStore.getAttachment({
          sandboxInstanceId: input.sandboxInstanceId,
          nowMs: this.clock.nowMs(),
        });
        logger.info(
          {
            eventName: "gateway.bootstrap.detach.recorded",
            ...this.bootstrapCloseDiagnostics(input.attachedPeer, {
              closeCode: input.closeCode,
              closeReason: input.closeReason,
            }),
            closeCode: input.closeCode,
            closeReason: input.closeReason,
            ownerLeaseId: input.leaseId,
            relaySessionId: input.attachedPeer.relayTarget.sessionId,
            sandboxInstanceId: input.sandboxInstanceId,
            previousAttachmentOwnerLeaseId: previousAttachment?.ownerLeaseId ?? null,
            previousAttachmentSessionId: previousAttachment?.sessionId ?? null,
            nextAttachmentOwnerLeaseId: nextAttachment?.ownerLeaseId ?? null,
            nextAttachmentSessionId: nextAttachment?.sessionId ?? null,
            disconnectDeadlineScheduled: true,
          },
          "Recorded sandbox bootstrap detach and scheduled disconnect reconciliation.",
        );
      },
    });

    const detachedBootstrapSession = this.tunnelSessionRegistry.detachBootstrapSession(
      input.attachedPeer.relayTarget,
    );
    this.relayCoordinator.detachPeerWithOptions({
      target: input.attachedPeer.relayTarget,
      notifyOppositePeer: false,
    });

    if (detachedBootstrapSession?.releasedBindings.length) {
      await notifyConnectionPeerOfBootstrapDisconnect({
        relayCoordinator: this.relayCoordinator,
        releasedBindings: detachedBootstrapSession.releasedBindings,
        sandboxInstanceId: input.sandboxInstanceId,
      }).catch((error: unknown) => {
        logger.error(
          {
            err: error,
            sandboxInstanceId: input.sandboxInstanceId,
          },
          "Failed notifying connection peer about disconnected interactive streams",
        );
      });
    }
    this.bootstrapCloseContextsBySessionId.delete(input.attachedPeer.relayTarget.sessionId);
  }

  /**
   * Releases all interactive streams associated with the detached connection peer,
   * notifies the bootstrap peer, and then unregisters the relay peer.
   */
  public async detachConnectionPeer(input: {
    attachedPeer: AttachedTunnelPeer;
    sandboxInstanceId: string;
  }): Promise<void> {
    input.attachedPeer.presenceLeaseRenewalHandle?.stop();
    input.attachedPeer.websocketHealthHandle?.stop();

    await this.sandboxPresenceStore
      .releaseLease({
        sandboxInstanceId: input.sandboxInstanceId,
        leaseId: input.attachedPeer.relayTarget.sessionId,
      })
      .catch((error: unknown) => {
        logger.error(
          {
            err: error,
            sandboxInstanceId: input.sandboxInstanceId,
            relaySessionId: input.attachedPeer.relayTarget.sessionId,
          },
          "Failed to release sandbox presence lease for disconnected connection peer",
        );
      });

    await this.interactiveStreamRouter
      .releaseClientSessionStreams({
        sandboxInstanceId: input.sandboxInstanceId,
        clientSessionId: input.attachedPeer.relayTarget.sessionId,
      })
      .then((result) =>
        notifyBootstrapPeerOfReleasedInteractiveStreams({
          relayCoordinator: this.relayCoordinator,
          releasedBindings: result.releasedBindings,
          sandboxInstanceId: input.sandboxInstanceId,
          ...(result.bootstrapTarget === undefined
            ? {}
            : { targetBootstrapSessionId: result.bootstrapTarget.sessionId }),
        }),
      )
      .catch((error: unknown) => {
        logger.error(
          {
            err: error,
            sandboxInstanceId: input.sandboxInstanceId,
          },
          "Failed forwarding stream.close during connection detach",
        );
      })
      .finally(() => {
        this.relayCoordinator.detachPeer(input.attachedPeer.relayTarget);
      });
  }

  private async refreshRuntimeAttachment(input: {
    attachedAtMs: number;
    leaseId: string;
    relaySessionId: string;
    sandboxInstanceId: string;
  }): Promise<void> {
    await this.sandboxRuntimeAttachmentStore.upsertAttachment({
      sandboxInstanceId: input.sandboxInstanceId,
      ownerLeaseId: input.leaseId,
      nodeId: this.gatewayNodeId,
      sessionId: input.relaySessionId,
      attachedAtMs: input.attachedAtMs,
      ttlMs: ATTACHMENT_TTL_MS,
      nowMs: this.clock.nowMs(),
    });
  }

  private async activateBootstrapAttachment(input: {
    attachedAtMs: number;
    attachedPeer: AttachedTunnelPeer;
    leaseId: string;
    onFatalError: (failure: TunnelSessionFatalError) => void;
    onLeaseLost: (failure: TunnelSessionLeaseLost) => void;
    ownerLeaseTtlMs: number;
    relaySessionId: string;
    relayTarget: RelayTarget;
    sandboxInstanceId: string;
    socket: RelayPeerSocket;
    testEnvironmentId?: string;
  }): Promise<void> {
    try {
      if (
        input.socket.readyState !== WebSocket.OPEN ||
        !this.relayCoordinator.isCurrentPeer(input.relayTarget)
      ) {
        return;
      }

      await this.refreshRuntimeAttachment({
        attachedAtMs: input.attachedAtMs,
        leaseId: input.leaseId,
        relaySessionId: input.relaySessionId,
        sandboxInstanceId: input.sandboxInstanceId,
      });

      await this.sandboxDeadlineLifecycleCoordinator
        .enqueue({
          sandboxInstanceId: input.sandboxInstanceId,
          operation: async () => {
            if (!this.relayCoordinator.isCurrentPeer(input.relayTarget)) {
              return;
            }

            await this.sandboxInstanceDeadlineService.handleBootstrapAttach({
              sandboxInstanceId: input.sandboxInstanceId,
              ownerLeaseId: input.leaseId,
              ...(input.testEnvironmentId === undefined
                ? {}
                : { testEnvironmentId: input.testEnvironmentId }),
            });
          },
        })
        .catch((error: unknown) => {
          logger.warn(
            {
              err: error,
              sandboxInstanceId: input.sandboxInstanceId,
              ownerLeaseId: input.leaseId,
              relaySessionId: input.relaySessionId,
            },
            "Failed to refresh sandbox idle deadline after bootstrap attachment",
          );
        });

      input.attachedPeer.leaseHeartbeatHandle = this.startRuntimeAttachmentRenewal({
        attachedAtMs: input.attachedAtMs,
        leaseId: input.leaseId,
        onLeaseLost: () => {
          this.recordBootstrapCloseContext({
            attachedPeer: input.attachedPeer,
            cause: BootstrapTunnelCloseCauses.GATEWAY_OWNER_LEASE_LOST,
            gatewayInitiated: true,
            reason: "Sandbox active attachment was replaced.",
          });
          logger.error(
            {
              eventName: "gateway.bootstrap.close.initiated",
              ...this.bootstrapCloseDiagnostics(input.attachedPeer),
              sandboxInstanceId: input.sandboxInstanceId,
              leaseId: input.leaseId,
            },
            "Lost sandbox active attachment while bootstrap websocket was still connected",
          );
          input.onLeaseLost({
            closeReason: "Sandbox active attachment was replaced.",
            statusMessage: "Sandbox active attachment was replaced.",
          });
        },
        onRefreshFailed: (error) => {
          this.recordBootstrapCloseContext({
            attachedPeer: input.attachedPeer,
            cause: BootstrapTunnelCloseCauses.GATEWAY_ATTACH_FATAL_ERROR,
            gatewayInitiated: true,
            reason: "Failed to refresh sandbox runtime attachment.",
          });
          logger.error(
            {
              err: error,
              eventName: "gateway.bootstrap.close.initiated",
              ...this.bootstrapCloseDiagnostics(input.attachedPeer),
              sandboxInstanceId: input.sandboxInstanceId,
            },
            "Failed to refresh sandbox runtime attachment",
          );
          input.onFatalError({
            closeReason: "Failed to refresh sandbox runtime attachment.",
            error,
            statusMessage: "Failed to refresh sandbox runtime attachment.",
          });
        },
        relaySessionId: input.relaySessionId,
        sandboxInstanceId: input.sandboxInstanceId,
        socket: input.socket,
        ttlMs: input.ownerLeaseTtlMs,
      });
    } catch (error) {
      this.recordBootstrapCloseContext({
        attachedPeer: input.attachedPeer,
        cause: BootstrapTunnelCloseCauses.GATEWAY_ATTACH_FATAL_ERROR,
        gatewayInitiated: true,
        reason: "Failed to activate sandbox runtime attachment for attached bootstrap tunnel.",
      });
      logger.error(
        {
          err: error,
          eventName: "gateway.bootstrap.close.initiated",
          ...this.bootstrapCloseDiagnostics(input.attachedPeer),
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
        },
        "Failed to activate sandbox runtime attachment for attached bootstrap tunnel",
      );
      input.onFatalError({
        closeReason: "Failed to activate sandbox runtime attachment for attached bootstrap tunnel.",
        error,
        statusMessage:
          "Failed to activate sandbox runtime attachment for attached bootstrap tunnel.",
      });
    }
  }

  private startRuntimeAttachmentRenewal(input: {
    attachedAtMs: number;
    leaseId: string;
    onLeaseLost: () => void;
    onRefreshFailed: (error: unknown) => void;
    relaySessionId: string;
    sandboxInstanceId: string;
    socket: RelayPeerSocket;
    ttlMs: number;
  }): LeaseRenewalHandle {
    let stopped = false;
    let scheduledHandle: TimerHandle | undefined;

    const scheduleNextRenewal = (): void => {
      if (stopped) {
        return;
      }

      scheduledHandle = this.scheduler.schedule(() => {
        void renewRuntimeAttachment();
      }, OWNER_LEASE_RENEW_INTERVAL_MS);
    };

    const renewRuntimeAttachment = async (): Promise<void> => {
      if (stopped) {
        return;
      }
      if (input.socket.readyState !== WebSocket.OPEN) {
        stopped = true;
        scheduledHandle = undefined;
        return;
      }

      const nowMs = this.clock.nowMs();

      try {
        const currentAttachment = await this.sandboxRuntimeAttachmentStore.getAttachment({
          sandboxInstanceId: input.sandboxInstanceId,
          nowMs,
        });
        if (
          currentAttachment !== null &&
          (currentAttachment.ownerLeaseId !== input.leaseId ||
            currentAttachment.sessionId !== input.relaySessionId)
        ) {
          stopped = true;
          scheduledHandle = undefined;
          input.onLeaseLost();
          return;
        }

        await this.refreshRuntimeAttachment({
          attachedAtMs: input.attachedAtMs,
          leaseId: input.leaseId,
          relaySessionId: input.relaySessionId,
          sandboxInstanceId: input.sandboxInstanceId,
        });
      } catch (error) {
        if (stopped) {
          return;
        }

        stopped = true;
        scheduledHandle = undefined;
        input.onRefreshFailed(error);
        return;
      }

      scheduleNextRenewal();
    };

    scheduleNextRenewal();

    return {
      stop: () => {
        if (stopped) {
          return;
        }

        stopped = true;
        if (scheduledHandle !== undefined) {
          this.scheduler.cancel(scheduledHandle);
          scheduledHandle = undefined;
        }
      },
    };
  }

  private startPresenceLeaseRenewal(input: {
    leaseId: string;
    onLeaseTouched: () => Promise<void>;
    onTouchFailed: (error: unknown) => void;
    relaySessionId: string;
    sandboxInstanceId: string;
    socket: RelayPeerSocket;
  }): {
    stop: () => void;
  } {
    let stopped = false;
    let scheduledHandle: TimerHandle | undefined;

    const scheduleNextRenewal = (): void => {
      if (stopped) {
        return;
      }

      scheduledHandle = this.scheduler.schedule(() => {
        void renewPresenceLease();
      }, PRESENCE_LEASE_RENEW_INTERVAL_MS);
    };

    const renewPresenceLease = async (): Promise<void> => {
      if (stopped) {
        return;
      }
      if (input.socket.readyState !== WebSocket.OPEN) {
        stopped = true;
        scheduledHandle = undefined;
        return;
      }

      const nowMs = this.clock.nowMs();

      try {
        await this.sandboxPresenceStore.touchLease({
          sandboxInstanceId: input.sandboxInstanceId,
          leaseId: input.leaseId,
          source: ConnectionPresenceLeaseSource,
          sessionId: input.relaySessionId,
          ttlMs: PRESENCE_LEASE_TTL_MS,
          nowMs,
        });
        await input.onLeaseTouched();
      } catch (error) {
        if (stopped) {
          return;
        }

        stopped = true;
        scheduledHandle = undefined;
        input.onTouchFailed(error);
        return;
      }

      scheduleNextRenewal();
    };

    void renewPresenceLease();

    return {
      stop: () => {
        if (stopped) {
          return;
        }

        stopped = true;
        if (scheduledHandle !== undefined) {
          this.scheduler.cancel(scheduledHandle);
          scheduledHandle = undefined;
        }
      },
    };
  }

  private async closeCurrentBootstrapPeer(input: {
    sandboxInstanceId: string;
    cause: BootstrapTunnelCloseCause;
    closeReason: string;
    statusMessage: string;
  }): Promise<void> {
    const bootstrapPeer = this.relayCoordinator.getBootstrapPeer({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (bootstrapPeer === undefined) {
      throw new Error(
        `Expected current bootstrap peer for sandbox '${input.sandboxInstanceId}' while closing the session.`,
      );
    }
    const initiatedAtMs = this.clock.nowMs();
    if (!this.bootstrapCloseContextsBySessionId.has(bootstrapPeer.sessionId)) {
      this.bootstrapCloseContextsBySessionId.set(bootstrapPeer.sessionId, {
        cause: input.cause,
        gatewayInitiated: true,
        initiatedAtMs,
        reason: input.closeReason,
      });
    }

    await this.relayCoordinator.closePeer({
      target: bootstrapPeer,
      closeCode: 1011,
      closeReason: input.closeReason,
    });
    logger.error(
      {
        eventName: "gateway.bootstrap.close.initiated",
        closeCause: input.cause,
        closeCauseReason: input.closeReason,
        closeInitiatedAtMs: initiatedAtMs,
        gatewayInitiatedClose: true,
        relaySessionId: bootstrapPeer.sessionId,
        sandboxInstanceId: input.sandboxInstanceId,
        closeReason: input.closeReason,
      },
      input.statusMessage,
    );
  }

  public markBootstrapCloseInitiated(input: {
    attachedPeer: AttachedTunnelPeer;
    cause: BootstrapTunnelCloseCause;
    reason: string;
  }): void {
    this.recordBootstrapCloseContext({
      attachedPeer: input.attachedPeer,
      cause: input.cause,
      gatewayInitiated: true,
      reason: input.reason,
    });
  }

  private recordBootstrapCloseContext(input: {
    attachedPeer: AttachedTunnelPeer;
    cause: BootstrapTunnelCloseCause;
    gatewayInitiated: boolean;
    reason: string;
  }): BootstrapTunnelCloseContext {
    const existingCloseContext =
      this.bootstrapCloseContextsBySessionId.get(input.attachedPeer.relayTarget.sessionId) ??
      input.attachedPeer.bootstrapCloseContext;
    if (existingCloseContext !== undefined) {
      input.attachedPeer.bootstrapCloseContext = existingCloseContext;
      this.bootstrapCloseContextsBySessionId.set(
        input.attachedPeer.relayTarget.sessionId,
        existingCloseContext,
      );
      return existingCloseContext;
    }

    const closeContext: BootstrapTunnelCloseContext = {
      cause: input.cause,
      gatewayInitiated: input.gatewayInitiated,
      initiatedAtMs: this.clock.nowMs(),
      reason: input.reason,
    };
    input.attachedPeer.bootstrapCloseContext = closeContext;
    this.bootstrapCloseContextsBySessionId.set(
      input.attachedPeer.relayTarget.sessionId,
      closeContext,
    );
    return closeContext;
  }

  public bootstrapCloseDiagnostics(
    attachedPeer: AttachedTunnelPeer,
    closeEvent?: {
      closeCode: number | undefined;
      closeReason: string | undefined;
    },
  ): BootstrapTunnelCloseDiagnostics {
    const nowMs = this.clock.nowMs();
    const closeContext =
      this.bootstrapCloseContextsBySessionId.get(attachedPeer.relayTarget.sessionId) ??
      attachedPeer.bootstrapCloseContext;
    const health = attachedPeer.websocketHealthHandle?.getSnapshot() ?? null;
    const hasPeerCloseFrame =
      closeContext === undefined &&
      closeEvent?.closeCode !== undefined &&
      closeEvent.closeCode !== 1005 &&
      closeEvent.closeCode !== 1006;
    const peerCloseReason = closeEvent?.closeReason?.trim() ?? "";
    return {
      closeCause:
        closeContext?.cause ??
        (hasPeerCloseFrame ? BootstrapTunnelCloseCauses.PEER_CLOSE_FRAME : undefined) ??
        (health?.healthy === false
          ? BootstrapTunnelCloseCauses.GATEWAY_HEALTH_MISSED_PONGS
          : BootstrapTunnelCloseCauses.TRANSPORT_ABNORMAL_CLOSE),
      gatewayInitiatedClose: closeContext?.gatewayInitiated ?? false,
      closeInitiatedAtMs: closeContext?.initiatedAtMs ?? null,
      closeCauseReason:
        closeContext?.reason ??
        (hasPeerCloseFrame
          ? peerCloseReason || "Bootstrap websocket peer sent close frame."
          : "Bootstrap websocket closed without gateway cause."),
      socketAgeMs:
        attachedPeer.openedAtMs === undefined ? 0 : Math.max(0, nowMs - attachedPeer.openedAtMs),
      health,
    };
  }
}
