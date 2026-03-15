import type { DataPlaneDatabase } from "@mistle/db/data-plane";

import { logger } from "../../logger.js";
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
import { TunnelLivelinessRepository } from "./tunnel-liveliness-repository.js";

/**
 * Captures the live relay target for an attached websocket peer plus any
 * teardown handle that must be stopped when the peer disconnects.
 */
export type AttachedTunnelPeer = {
  relayTarget: RelayTarget;
  leaseHeartbeatHandle?: SandboxOwnerLeaseHeartbeatHandle;
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

export class TunnelSessionService {
  public constructor(
    private readonly interactiveStreamRouter: InteractiveStreamRouter,
    private readonly relayCoordinator: TunnelRelayCoordinator,
    private readonly tunnelSessionRegistry: TunnelSessionRegistry,
    private readonly sandboxOwnerStore: SandboxOwnerStore,
    private readonly sandboxOwnerLeaseHeartbeat: SandboxOwnerLeaseHeartbeat,
    private readonly livelinessRepository: TunnelLivelinessRepository,
  ) {}

  /**
   * Attaches the bootstrap websocket as the owner-local tunnel peer and starts
   * the lease heartbeat and liveliness persistence side effects for that lease.
   */
  public attachBootstrapPeer(input: {
    db: DataPlaneDatabase;
    leaseId: string;
    onFatalError: (failure: TunnelSessionFatalError) => void;
    onLeaseLost: (failure: TunnelSessionLeaseLost) => void;
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

    void this.livelinessRepository
      .markConnected({
        db: input.db,
        leaseId: input.leaseId,
        sandboxInstanceId: input.sandboxInstanceId,
      })
      .catch((error: unknown) => {
        logger.error(
          {
            err: error,
            sandboxInstanceId: input.sandboxInstanceId,
          },
          "Failed to persist sandbox tunnel connected timestamp",
        );
        input.onFatalError({
          closeReason: "Failed to persist sandbox tunnel connection.",
          error,
          statusMessage: "Failed to persist sandbox tunnel connection.",
        });
      });

    const leaseHeartbeatHandle = this.sandboxOwnerLeaseHeartbeat.start({
      sandboxInstanceId: input.sandboxInstanceId,
      leaseId: input.leaseId,
      ttlMs: input.ownerLeaseTtlMs,
      onLeaseRenewed: () => {
        void this.livelinessRepository
          .markSeen({
            db: input.db,
            leaseId: input.leaseId,
            sandboxInstanceId: input.sandboxInstanceId,
          })
          .then((updated: boolean) => {
            if (updated) {
              return;
            }

            logger.info(
              {
                leaseId: input.leaseId,
                sandboxInstanceId: input.sandboxInstanceId,
              },
              "Skipped sandbox tunnel heartbeat update for stale bootstrap lease",
            );
          })
          .catch((error: unknown) => {
            logger.error(
              {
                err: error,
                sandboxInstanceId: input.sandboxInstanceId,
              },
              "Failed to persist sandbox tunnel heartbeat timestamp",
            );
          });
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
    };
  }

  /**
   * Attaches a connection websocket as a relay peer for the target sandbox.
   */
  public attachConnectionPeer(input: {
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

    return {
      relayTarget,
    };
  }

  /**
   * Detaches the bootstrap peer, stops lease renewal, persists disconnection,
   * releases owner-local bindings, and notifies any affected connection peers.
   */
  public async detachBootstrapPeer(input: {
    attachedPeer: AttachedTunnelPeer;
    db: DataPlaneDatabase;
    leaseId: string;
    sandboxInstanceId: string;
  }): Promise<void> {
    input.attachedPeer.leaseHeartbeatHandle?.stop();

    void this.livelinessRepository
      .markDisconnected({
        db: input.db,
        leaseId: input.leaseId,
        sandboxInstanceId: input.sandboxInstanceId,
      })
      .then((updated: boolean) => {
        if (updated) {
          return;
        }

        logger.info(
          {
            leaseId: input.leaseId,
            sandboxInstanceId: input.sandboxInstanceId,
          },
          "Skipped sandbox tunnel disconnected update for stale bootstrap lease",
        );
      })
      .catch((error: unknown) => {
        logger.error(
          {
            err: error,
            sandboxInstanceId: input.sandboxInstanceId,
          },
          "Failed to persist sandbox tunnel disconnected timestamp",
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
}
