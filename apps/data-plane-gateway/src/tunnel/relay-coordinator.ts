import { randomUUID } from "node:crypto";

import { LocalPeerRegistry } from "./local-peer-registry/index.js";
import { RelayTransport } from "./relay-transport/index.js";
import type {
  LocalPeerDescriptor,
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
const PeerDisconnectedControlPayload = JSON.stringify({
  type: "disconnect",
  reason: "Sandbox tunnel connection peer disconnected.",
});

function getOppositeSide(side: RelayPeerSide): RelayPeerSide {
  return side === "bootstrap" ? "connection" : "bootstrap";
}

function isSamePeerLocation(left: RelayTarget, right: RelayTarget): boolean {
  return (
    left.sandboxInstanceId === right.sandboxInstanceId &&
    left.side === right.side &&
    left.nodeId === right.nodeId &&
    left.sessionId === right.sessionId
  );
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
  }): RelayTarget {
    const target: RelayTarget = {
      sandboxInstanceId: input.sandboxInstanceId,
      side: input.side,
      nodeId: this.nodeId,
      sessionId: randomUUID(),
    };

    this.relayTransport.registerLocalPeer({
      target,
      socket: input.socket,
    });

    const replacedPeer = this.peerRegistry.setPeer(target);
    if (replacedPeer !== undefined) {
      this.relayTransport.closePeer({
        target: replacedPeer,
        closeCode: CloseCodes.REPLACED,
        closeReason: "Replaced by newer sandbox tunnel connection.",
      });
    }

    return target;
  }

  public isCurrentPeer(input: RelayTarget): boolean {
    const current = this.peerRegistry.getPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: input.side,
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
  }): Promise<void> {
    const target = this.peerRegistry.getPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: getOppositeSide(input.fromSide),
    });
    if (target === undefined) {
      return;
    }

    await this.relayTransport.forwardToPeer({
      target,
      payload: input.payload,
    });
  }

  public detachPeer(input: RelayTarget): void {
    this.relayTransport.unregisterLocalPeer({
      target: input,
    });

    const removed = this.peerRegistry.removePeer(input);
    if (!removed) {
      return;
    }

    if (input.side === "connection") {
      const opposite = this.peerRegistry.getPeer({
        sandboxInstanceId: input.sandboxInstanceId,
        side: getOppositeSide(input.side),
      });
      if (opposite !== undefined) {
        void this.relayTransport
          .forwardToPeer({
            target: opposite,
            payload: PeerDisconnectedControlPayload,
          })
          .catch(() => undefined);
      }
      return;
    }

    const opposite = this.peerRegistry.getPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: getOppositeSide(input.side),
    });
    if (opposite === undefined) {
      return;
    }

    this.relayTransport.closePeer({
      target: opposite,
      closeCode: CloseCodes.PEER_DISCONNECTED,
      closeReason: "Sandbox tunnel peer disconnected.",
    });
  }

  public getPeer(input: LocalPeerDescriptor): RelayTarget | undefined {
    return this.peerRegistry.getPeer(input);
  }
}
