import { LocalPeerRegistry } from "./local-peer-registry/index.js";
import { RelayTransport } from "./relay-transport/index.js";
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
    private readonly peerRegistry: LocalPeerRegistry,
    private readonly relayTransport: RelayTransport,
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
        : this.peerRegistry.setConnectionPeer(target);
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
        : this.peerRegistry.getConnectionPeer({
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
        ? this.peerRegistry.getBootstrapPeer({
            sandboxInstanceId: input.sandboxInstanceId,
          })
        : input.targetSessionId === undefined
          ? undefined
          : this.peerRegistry.getConnectionPeer({
              sandboxInstanceId: input.sandboxInstanceId,
              side: "connection",
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

    if (input.target.side === "connection") {
      return;
    }

    const oppositePeers = this.peerRegistry.listConnectionPeers({
      sandboxInstanceId: input.target.sandboxInstanceId,
    });
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
}
