import type { LocalPeerRegistryAdapter } from "./local-peer-registry/local-peer-registry-adapter.js";
import { LocalRelayPeerResolver } from "./local-peer-registry/local-relay-peer-resolver.js";
import type { RelayPeerResolver } from "./relay-peer-resolver.js";
import type { RelayTransportAdapter } from "./relay-transport/relay-transport-adapter.js";
import type {
  RelayCloseEnvelope,
  RelayFrameEnvelope,
  RelayPayload,
  RelayPeerSide,
  RelayPeerSocket,
  RelayTarget,
} from "./types.js";

const CloseCodes: {
  REPLACED: number;
  PEER_DISCONNECTED: number;
} = {
  REPLACED: 1012,
  PEER_DISCONNECTED: 1012,
};

function isSamePeerLocation(left: RelayTarget, right: RelayTarget): boolean {
  return (
    left.sandboxInstanceId === right.sandboxInstanceId &&
    left.side === right.side &&
    left.nodeId === right.nodeId &&
    left.sessionId === right.sessionId
  );
}

function toFrameEnvelope(input: {
  target: RelayTarget;
  payload: RelayPayload;
}): RelayFrameEnvelope {
  return {
    kind: "frame",
    target: input.target,
    payload: input.payload,
  };
}

function toCloseEnvelope(input: {
  target: RelayTarget;
  closeCode: number;
  closeReason: string;
}): RelayCloseEnvelope {
  return {
    kind: "close",
    target: input.target,
    closeCode: input.closeCode,
    closeReason: input.closeReason,
  };
}

export class TunnelRelayCoordinator {
  public constructor(
    private readonly nodeId: string,
    private readonly peerRegistry: LocalPeerRegistryAdapter,
    private readonly relayTransport: RelayTransportAdapter,
    private readonly peerResolver: RelayPeerResolver = new LocalRelayPeerResolver(peerRegistry),
  ) {}

  public attachPeer(input: {
    sandboxInstanceId: string;
    side: RelayPeerSide;
    socket: RelayPeerSocket;
    sessionId: string;
  }): RelayTarget {
    const target: RelayTarget = {
      sandboxInstanceId: input.sandboxInstanceId,
      side: input.side,
      nodeId: this.nodeId,
      sessionId: input.sessionId,
    };

    this.relayTransport.registerLocalPeer({
      target,
      socket: input.socket,
    });

    const replacedPeer =
      input.side === "bootstrap"
        ? this.peerRegistry.setBootstrapPeer(target)
        : this.peerRegistry.setSessionPeer(target);
    if (replacedPeer !== undefined) {
      void this.relayTransport
        .deliverEnvelope(
          toCloseEnvelope({
            target: replacedPeer,
            closeCode: CloseCodes.REPLACED,
            closeReason: "Replaced by newer sandbox tunnel connection.",
          }),
        )
        .catch(() => undefined);
    }

    return target;
  }

  public isCurrentPeer(input: RelayTarget): boolean {
    const current =
      input.side === "bootstrap"
        ? this.peerRegistry.getBootstrapPeer({
            sandboxInstanceId: input.sandboxInstanceId,
          })
        : this.peerRegistry.getSessionPeer({
            sandboxInstanceId: input.sandboxInstanceId,
            side: input.side,
            sessionId: input.sessionId,
          });
    if (current === undefined) {
      return false;
    }

    return isSamePeerLocation(current, input);
  }

  public async forwardPeerMessage(input: {
    sandboxInstanceId: string;
    fromSide: RelayPeerSide;
    payload: RelayPayload;
    targetSessionId?: string | undefined;
  }): Promise<void> {
    const target =
      input.fromSide === "connection"
        ? await this.peerResolver.resolveBootstrapPeer({
            sandboxInstanceId: input.sandboxInstanceId,
            ...(input.targetSessionId === undefined
              ? {}
              : { targetSessionId: input.targetSessionId }),
          })
        : input.targetSessionId === undefined
          ? undefined
          : await this.peerResolver.resolveConnectionPeer({
              sandboxInstanceId: input.sandboxInstanceId,
              sessionId: input.targetSessionId,
            });
    if (target === undefined) {
      return;
    }

    await this.relayTransport.deliverEnvelope(
      toFrameEnvelope({
        target,
        payload: input.payload,
      }),
    );
  }

  public async forwardSessionPeerMessage(input: {
    sandboxInstanceId: string;
    targetSide: RelayPeerSide;
    targetSessionId: string;
    payload: RelayPayload;
  }): Promise<void> {
    if (input.targetSide === "bootstrap") {
      throw new Error("Use forwardPeerMessage to target bootstrap peers.");
    }

    const target = await this.peerResolver.resolveSessionPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: input.targetSide,
      sessionId: input.targetSessionId,
    });
    if (target === undefined) {
      return;
    }

    await this.relayTransport.deliverEnvelope(
      toFrameEnvelope({
        target,
        payload: input.payload,
      }),
    );
  }

  public async closeSessionPeer(input: {
    sandboxInstanceId: string;
    targetSide: RelayPeerSide;
    targetSessionId: string;
    closeCode: number;
    closeReason: string;
  }): Promise<void> {
    if (input.targetSide === "bootstrap") {
      throw new Error("Use closePeer to target bootstrap peers.");
    }

    const target = await this.resolveSessionPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: input.targetSide,
      sessionId: input.targetSessionId,
    });
    if (target === undefined) {
      return;
    }

    await this.closePeer({
      target,
      closeCode: input.closeCode,
      closeReason: input.closeReason,
    });
  }

  public async resolveSessionPeer(input: {
    sandboxInstanceId: string;
    side: RelayPeerSide;
    sessionId: string;
  }): Promise<RelayTarget | undefined> {
    if (input.side === "bootstrap") {
      return this.peerResolver.resolveBootstrapPeer({
        sandboxInstanceId: input.sandboxInstanceId,
        targetSessionId: input.sessionId,
      });
    }

    return this.peerResolver.resolveSessionPeer(input);
  }

  public async closePeer(input: {
    target: RelayTarget;
    closeCode: number;
    closeReason: string;
  }): Promise<void> {
    await this.relayTransport.deliverEnvelope(
      toCloseEnvelope({
        target: input.target,
        closeCode: input.closeCode,
        closeReason: input.closeReason,
      }),
    );
  }

  public detachPeer(input: RelayTarget): void {
    this.detachPeerWithOptions({
      target: input,
      notifyOppositePeer: true,
    });
  }

  public detachPeerWithOptions(input: { target: RelayTarget; notifyOppositePeer: boolean }): void {
    this.relayTransport.unregisterLocalPeer({
      target: input.target,
    });

    const removed = this.peerRegistry.removePeer(input.target);
    if (!removed) {
      return;
    }

    const oppositePeers = this.listOppositePeersForDetachedPeer(input.target);
    if (!input.notifyOppositePeer || oppositePeers.length === 0) {
      return;
    }

    for (const oppositePeer of oppositePeers) {
      void this.relayTransport
        .deliverEnvelope(
          toCloseEnvelope({
            target: oppositePeer,
            closeCode: CloseCodes.PEER_DISCONNECTED,
            closeReason: "Sandbox tunnel peer disconnected.",
          }),
        )
        .catch(() => undefined);
    }
  }

  private listOppositePeersForDetachedPeer(target: RelayTarget): RelayTarget[] {
    if (target.side === "connection") {
      return [];
    }

    if (target.side === "ptyClient" || target.side === "ptySandbox") {
      const oppositeSide = target.side === "ptyClient" ? "ptySandbox" : "ptyClient";
      return this.peerRegistry
        .listSessionPeers({
          sandboxInstanceId: target.sandboxInstanceId,
          side: oppositeSide,
        })
        .filter((peer) => peer.sessionId === target.sessionId);
    }

    return [
      ...this.peerRegistry.listConnectionPeers({
        sandboxInstanceId: target.sandboxInstanceId,
      }),
      ...this.peerRegistry.listSessionPeers({
        sandboxInstanceId: target.sandboxInstanceId,
        side: "ptyClient",
      }),
      ...this.peerRegistry.listSessionPeers({
        sandboxInstanceId: target.sandboxInstanceId,
        side: "ptySandbox",
      }),
    ];
  }

  public getConnectionPeer(input: {
    sandboxInstanceId: string;
    sessionId: string;
  }): RelayTarget | undefined {
    return this.peerRegistry.getConnectionPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: "connection",
      sessionId: input.sessionId,
    });
  }

  public getBootstrapPeer(input: { sandboxInstanceId: string }): RelayTarget | undefined {
    return this.peerRegistry.getBootstrapPeer({
      sandboxInstanceId: input.sandboxInstanceId,
    });
  }
}
