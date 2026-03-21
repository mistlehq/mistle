import type { Clock, Scheduler, TimerHandle } from "@mistle/time";

import type { SandboxIdleControllerRegistry } from "../../idle/sandbox-idle-controller-registry.js";
import { logger } from "../../logger.js";
import {
  ATTACHMENT_TTL_MS,
  PRESENCE_LEASE_RENEW_INTERVAL_MS,
  PRESENCE_LEASE_TTL_MS,
  WEBSOCKET_PING_INTERVAL_MS,
  WEBSOCKET_PONG_TIMEOUT_MS,
} from "../../runtime-state/durations.js";
import type { SandboxPresenceStore } from "../../runtime-state/sandbox-presence-store.js";
import type { SandboxRuntimeAttachmentStore } from "../../runtime-state/sandbox-runtime-attachment-store.js";
import type { InteractiveStreamRouter } from "../gateway-forwarding/index.js";
import type {
  SandboxOwnerLeaseHeartbeat,
  SandboxOwnerLeaseHeartbeatHandle,
} from "../ownership/sandbox-owner-lease-heartbeat.js";
import type { SandboxOwnerStore } from "../ownership/sandbox-owner-store.js";
import type { TunnelRelayCoordinator } from "../relay-coordinator.js";
import {
  notifyBootstrapPeerOfReleasedInteractiveStreams,
  notifyConnectionPeerOfBootstrapDisconnect,
  notifyConnectionPeerOfReleasedInteractiveStreams,
} from "../tunnel-peer-notifier.js";
import type { TunnelSessionRegistry } from "../tunnel-session/index.js";
import type { RelayPeerSocket, RelayTarget } from "../types.js";
import { startWebSocketHealthMonitor } from "./websocket-health-monitor.js";

const ConnectionPresenceLeaseKind = "agent";
const ConnectionPresenceLeaseSource = "dashboard";
const WebSocketOpenReadyState = 1;

/**
 * Captures the live relay target for an attached websocket peer plus any
 * teardown handle that must be stopped when the peer disconnects.
 */
export type AttachedTunnelPeer = {
  relayTarget: RelayTarget;
  leaseHeartbeatHandle?: SandboxOwnerLeaseHeartbeatHandle;
  presenceLeaseRenewalHandle?: {
    stop: () => void;
  };
  websocketHealthHandle?: {
    stop: () => void;
    isHealthy: () => boolean;
  };
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
  public constructor(
    private readonly gatewayNodeId: string,
    private readonly interactiveStreamRouter: InteractiveStreamRouter,
    private readonly relayCoordinator: TunnelRelayCoordinator,
    private readonly tunnelSessionRegistry: TunnelSessionRegistry,
    private readonly sandboxOwnerStore: SandboxOwnerStore,
    private readonly sandboxOwnerLeaseHeartbeat: SandboxOwnerLeaseHeartbeat,
    private readonly sandboxPresenceStore: SandboxPresenceStore,
    private readonly sandboxRuntimeAttachmentStore: SandboxRuntimeAttachmentStore,
    private readonly sandboxIdleControllerRegistry: SandboxIdleControllerRegistry,
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
    onTransportUnhealthy: (failure: TunnelSessionTransportUnhealthy) => void;
    ownerLeaseTtlMs: number;
    relaySessionId: string;
    sandboxInstanceId: string;
    socket: RelayPeerSocket;
  }): AttachedTunnelPeer {
    const relayTarget = this.relayCoordinator.attachPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: "bootstrap",
      sessionId: input.relaySessionId,
      socket: input.socket,
    });
    const attachResult = this.tunnelSessionRegistry.attachBootstrapSession(relayTarget);

    const runtimeAttachmentAttachedAtMs = this.clock.nowMs();
    const sandboxIdleController = this.sandboxIdleControllerRegistry.ensureController({
      sandboxInstanceId: input.sandboxInstanceId,
      ownerLeaseId: input.leaseId,
      nowMs: runtimeAttachmentAttachedAtMs,
    });
    sandboxIdleController.start({
      nowMs: runtimeAttachmentAttachedAtMs,
    });
    let websocketHealthHandle:
      | {
          stop: () => void;
          isHealthy: () => boolean;
        }
      | undefined;

    try {
      websocketHealthHandle = startWebSocketHealthMonitor({
        socket: input.socket,
        scheduler: this.scheduler,
        pingIntervalMs: WEBSOCKET_PING_INTERVAL_MS,
        pongTimeoutMs: WEBSOCKET_PONG_TIMEOUT_MS,
        onUnhealthy: () => {
          logger.error(
            {
              sandboxInstanceId: input.sandboxInstanceId,
              leaseId: input.leaseId,
            },
            "Bootstrap websocket stopped responding to ping/pong health checks",
          );
          input.onTransportUnhealthy({
            closeReason: "Sandbox bootstrap websocket stopped responding to ping.",
            statusMessage: "Sandbox bootstrap websocket stopped responding to ping.",
          });
        },
      });
    } catch (error) {
      logger.error(
        {
          err: error,
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

    void this.refreshRuntimeAttachment({
      attachedAtMs: runtimeAttachmentAttachedAtMs,
      leaseId: input.leaseId,
      relaySessionId: input.relaySessionId,
      sandboxInstanceId: input.sandboxInstanceId,
    }).catch((error: unknown) => {
      logger.error(
        {
          err: error,
          sandboxInstanceId: input.sandboxInstanceId,
        },
        "Failed to persist sandbox runtime attachment",
      );
      input.onFatalError({
        closeReason: "Failed to persist sandbox runtime attachment.",
        error,
        statusMessage: "Failed to persist sandbox runtime attachment.",
      });
    });

    void notifyConnectionPeerOfReleasedInteractiveStreams({
      relayCoordinator: this.relayCoordinator,
      releasedBindings: attachResult.releasedBindings,
      sandboxInstanceId: input.sandboxInstanceId,
    }).catch((error: unknown) => {
      logger.error(
        {
          err: error,
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

    const leaseHeartbeatHandle = this.sandboxOwnerLeaseHeartbeat.start({
      sandboxInstanceId: input.sandboxInstanceId,
      leaseId: input.leaseId,
      ttlMs: input.ownerLeaseTtlMs,
      onLeaseRenewed: () => {
        if (websocketHealthHandle?.isHealthy() === true) {
          void this.refreshRuntimeAttachment({
            attachedAtMs: runtimeAttachmentAttachedAtMs,
            leaseId: input.leaseId,
            relaySessionId: input.relaySessionId,
            sandboxInstanceId: input.sandboxInstanceId,
          }).catch((error: unknown) => {
            logger.error(
              {
                err: error,
                sandboxInstanceId: input.sandboxInstanceId,
              },
              "Failed to refresh sandbox runtime attachment",
            );
          });
        }
      },
      onLeaseLost: () => {
        logger.error(
          {
            sandboxInstanceId: input.sandboxInstanceId,
            leaseId: input.leaseId,
          },
          "Lost sandbox ownership while bootstrap websocket was still connected",
        );
        input.onLeaseLost({
          closeReason: "Sandbox ownership lease could not be renewed.",
          statusMessage: "Sandbox ownership lease could not be renewed.",
        });
      },
    });

    return {
      leaseHeartbeatHandle,
      relayTarget,
      ...(websocketHealthHandle === undefined ? {} : { websocketHealthHandle }),
    };
  }

  /**
   * Attaches a connection websocket as a relay peer for the target sandbox.
   */
  public attachConnectionPeer(input: {
    onFatalError: (failure: TunnelSessionFatalError) => void;
    onTransportUnhealthy: (failure: TunnelSessionTransportUnhealthy) => void;
    relaySessionId: string;
    sandboxInstanceId: string;
    socket: RelayPeerSocket;
  }): AttachedTunnelPeer {
    const relayTarget = this.relayCoordinator.attachPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: "connection",
      sessionId: input.relaySessionId,
      socket: input.socket,
    });

    const sandboxIdleController = this.sandboxIdleControllerRegistry.getController({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (sandboxIdleController === null) {
      throw new Error(
        `Expected idle controller for sandbox '${input.sandboxInstanceId}' before attaching connection peer.`,
      );
    }

    let websocketHealthHandle:
      | {
          stop: () => void;
          isHealthy: () => boolean;
        }
      | undefined;
    let presenceLeaseRenewalHandle:
      | {
          stop: () => void;
        }
      | undefined;
    try {
      websocketHealthHandle = startWebSocketHealthMonitor({
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
      onLeaseTouched: (nowMs) => {
        sandboxIdleController.handlePresenceLeaseTouch({
          leaseId: input.relaySessionId,
          nowMs,
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
        input.onFatalError({
          closeReason: "Failed to persist sandbox presence lease.",
          error,
          statusMessage: "Failed to persist sandbox presence lease.",
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
    leaseId: string;
    sandboxInstanceId: string;
  }): Promise<void> {
    input.attachedPeer.leaseHeartbeatHandle?.stop();
    input.attachedPeer.websocketHealthHandle?.stop();

    if (!this.relayCoordinator.isCurrentPeer(input.attachedPeer.relayTarget)) {
      this.relayCoordinator.detachPeerWithOptions({
        target: input.attachedPeer.relayTarget,
        notifyOppositePeer: false,
      });
      return;
    }

    this.sandboxIdleControllerRegistry
      .getController({
        sandboxInstanceId: input.sandboxInstanceId,
      })
      ?.handleBootstrapDisconnect({
        nowMs: this.clock.nowMs(),
      });

    void this.sandboxRuntimeAttachmentStore
      .clearAttachment({
        sandboxInstanceId: input.sandboxInstanceId,
        ownerLeaseId: input.leaseId,
      })
      .catch((error: unknown) => {
        logger.error(
          {
            err: error,
            sandboxInstanceId: input.sandboxInstanceId,
          },
          "Failed to clear sandbox runtime attachment for disconnected bootstrap tunnel",
        );
      });

    void this.sandboxOwnerStore
      .releaseOwner({
        sandboxInstanceId: input.sandboxInstanceId,
        leaseId: input.leaseId,
      })
      .catch((error: unknown) => {
        logger.error(
          {
            err: error,
            sandboxInstanceId: input.sandboxInstanceId,
          },
          "Failed to release sandbox ownership for disconnected bootstrap tunnel",
        );
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

  private startPresenceLeaseRenewal(input: {
    leaseId: string;
    onLeaseTouched: (nowMs: number) => void;
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
      if (input.socket.readyState !== WebSocketOpenReadyState) {
        stopped = true;
        scheduledHandle = undefined;
        return;
      }

      const nowMs = this.clock.nowMs();

      try {
        await this.sandboxPresenceStore.touchLease({
          sandboxInstanceId: input.sandboxInstanceId,
          leaseId: input.leaseId,
          kind: ConnectionPresenceLeaseKind,
          source: ConnectionPresenceLeaseSource,
          sessionId: input.relaySessionId,
          ttlMs: PRESENCE_LEASE_TTL_MS,
          nowMs,
        });
      } catch (error) {
        if (stopped) {
          return;
        }

        stopped = true;
        scheduledHandle = undefined;
        input.onTouchFailed(error);
        return;
      }

      input.onLeaseTouched(nowMs);
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
}
