import type { Clock, Scheduler, TimerHandle } from "@mistle/time";
import { WebSocket } from "ws";

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

const ConnectionPresenceLeaseSource = "dashboard";

type LeaseRenewalHandle = {
  stop: () => void;
};

/**
 * Captures the live relay target for an attached websocket peer plus any
 * teardown handle that must be stopped when the peer disconnects.
 */
export type AttachedTunnelPeer = {
  activationPromise?: Promise<void>;
  relayTarget: RelayTarget;
  leaseHeartbeatHandle?: LeaseRenewalHandle;
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
  private readonly bootstrapLifecycleTransitions = new Map<string, Promise<void>>();

  public constructor(
    private readonly gatewayNodeId: string,
    private readonly interactiveStreamRouter: InteractiveStreamRouter,
    private readonly relayCoordinator: TunnelRelayCoordinator,
    private readonly tunnelSessionRegistry: TunnelSessionRegistry,
    private readonly sandboxOwnerStore: SandboxOwnerStore,
    private readonly sandboxPresenceStore: SandboxPresenceStore,
    private readonly sandboxRuntimeAttachmentStore: SandboxRuntimeAttachmentStore,
    private readonly sandboxInstanceDeadlineService: SandboxInstanceDeadlineService,
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
    let websocketHealthHandle:
      | {
          stop: () => void;
          isHealthy: () => boolean;
        }
      | undefined;

    const attachedPeer: AttachedTunnelPeer = {
      relayTarget,
    };

    try {
      websocketHealthHandle = startWebSocketHealthMonitor({
        clock: this.clock,
        socketKind: "bootstrap",
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
        },
        onUnhealthy: () => {
          logger.error(
            {
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
      websocketHealthHandle,
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

    if (websocketHealthHandle !== undefined) {
      attachedPeer.websocketHealthHandle = websocketHealthHandle;
    }

    return attachedPeer;
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
        clock: this.clock,
        socketKind: "connection",
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
      onLeaseTouched: async () => {
        const activeSession = await this.sandboxRuntimeAttachmentStore.getAttachment({
          sandboxInstanceId: input.sandboxInstanceId,
          nowMs: this.clock.nowMs(),
        });
        if (activeSession === null) {
          throw new Error(
            `Expected active bootstrap session for sandbox '${input.sandboxInstanceId}' before touching presence deadline.`,
          );
        }

        await this.sandboxInstanceDeadlineService.touchIdleDeadline({
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: activeSession.ownerLeaseId,
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

    await this.enqueueBootstrapLifecycleTransition({
      sandboxInstanceId: input.sandboxInstanceId,
      operation: async () => {
        if (!this.relayCoordinator.isCurrentPeer(input.attachedPeer.relayTarget)) {
          return;
        }

        await this.sandboxInstanceDeadlineService.handleBootstrapDisconnect({
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
        });
      },
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

  private async renewActiveOwnerLease(input: {
    leaseId: string;
    sandboxInstanceId: string;
    ttlMs: number;
  }): Promise<boolean> {
    return this.sandboxOwnerStore.renewOwnerLease({
      sandboxInstanceId: input.sandboxInstanceId,
      leaseId: input.leaseId,
      ttlMs: input.ttlMs,
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
    websocketHealthHandle?:
      | {
          stop: () => void;
          isHealthy: () => boolean;
        }
      | undefined;
  }): Promise<void> {
    try {
      const owner = await this.sandboxOwnerStore.claimOwner({
        leaseId: input.leaseId,
        sandboxInstanceId: input.sandboxInstanceId,
        nodeId: this.gatewayNodeId,
        sessionId: input.relaySessionId,
        ttlMs: input.ownerLeaseTtlMs,
      });
      if (owner.leaseId !== input.leaseId) {
        throw new Error(
          `Expected claimed owner lease '${input.leaseId}' for sandbox '${input.sandboxInstanceId}', received '${owner.leaseId}' instead.`,
        );
      }

      if (
        input.socket.readyState !== WebSocket.OPEN ||
        !this.relayCoordinator.isCurrentPeer(input.relayTarget)
      ) {
        await this.sandboxOwnerStore.releaseOwner({
          sandboxInstanceId: input.sandboxInstanceId,
          leaseId: owner.leaseId,
        });
        return;
      }

      await this.refreshRuntimeAttachment({
        attachedAtMs: input.attachedAtMs,
        leaseId: owner.leaseId,
        relaySessionId: input.relaySessionId,
        sandboxInstanceId: input.sandboxInstanceId,
      });

      await this.enqueueBootstrapLifecycleTransition({
        sandboxInstanceId: input.sandboxInstanceId,
        operation: async () => {
          if (!this.relayCoordinator.isCurrentPeer(input.relayTarget)) {
            return;
          }

          await this.sandboxInstanceDeadlineService.handleBootstrapAttach({
            sandboxInstanceId: input.sandboxInstanceId,
            ownerLeaseId: owner.leaseId,
          });
        },
      });

      input.attachedPeer.leaseHeartbeatHandle = this.startRuntimeAttachmentRenewal({
        attachedAtMs: input.attachedAtMs,
        leaseId: owner.leaseId,
        onLeaseLost: () => {
          logger.error(
            {
              sandboxInstanceId: input.sandboxInstanceId,
              leaseId: owner.leaseId,
            },
            "Lost sandbox active attachment while bootstrap websocket was still connected",
          );
          input.onLeaseLost({
            closeReason: "Sandbox active attachment was replaced.",
            statusMessage: "Sandbox active attachment was replaced.",
          });
        },
        onRefreshFailed: (error) => {
          logger.error(
            {
              err: error,
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
        websocketHealthHandle: input.websocketHealthHandle,
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.leaseId,
        },
        "Failed to activate sandbox ownership for attached bootstrap tunnel",
      );
      input.onFatalError({
        closeReason: "Failed to activate sandbox ownership for attached bootstrap tunnel.",
        error,
        statusMessage: "Failed to activate sandbox ownership for attached bootstrap tunnel.",
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
    websocketHealthHandle?:
      | {
          stop: () => void;
          isHealthy: () => boolean;
        }
      | undefined;
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

        if (input.websocketHealthHandle?.isHealthy() === true || currentAttachment === null) {
          const renewed = await this.renewActiveOwnerLease({
            leaseId: input.leaseId,
            sandboxInstanceId: input.sandboxInstanceId,
            ttlMs: input.ttlMs,
          });
          if (!renewed) {
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
        }
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

    await this.relayCoordinator.closePeer({
      target: bootstrapPeer,
      closeCode: 1011,
      closeReason: input.closeReason,
    });
    logger.error(
      {
        sandboxInstanceId: input.sandboxInstanceId,
        closeReason: input.closeReason,
      },
      input.statusMessage,
    );
  }

  private async enqueueBootstrapLifecycleTransition(input: {
    sandboxInstanceId: string;
    operation: () => Promise<void>;
  }): Promise<void> {
    const previousTransition = this.bootstrapLifecycleTransitions.get(input.sandboxInstanceId);
    const currentTransition = (previousTransition ?? Promise.resolve())
      .catch(() => {
        // Keep later lifecycle transitions flowing after an earlier failure.
      })
      .then(input.operation);

    this.bootstrapLifecycleTransitions.set(input.sandboxInstanceId, currentTransition);

    try {
      await currentTransition;
    } finally {
      if (this.bootstrapLifecycleTransitions.get(input.sandboxInstanceId) === currentTransition) {
        this.bootstrapLifecycleTransitions.delete(input.sandboxInstanceId);
      }
    }
  }
}
