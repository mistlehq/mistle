import { randomUUID } from "node:crypto";

import { TunnelFrameTransport } from "./frame-transport/index.js";
import { TunnelPeerRegistry } from "./peer-registry/index.js";
import type {
  TunnelFramePayload,
  TunnelPeerDescriptor,
  TunnelPeerLocation,
  TunnelPeerSide,
  TunnelPeerSocket,
} from "./types.js";

const CloseCodes: {
  REPLACED: number;
  PEER_DISCONNECTED: number;
} = {
  REPLACED: 1012,
  PEER_DISCONNECTED: 1012,
};

function getOppositeSide(side: TunnelPeerSide): TunnelPeerSide {
  return side === "bootstrap" ? "connection" : "bootstrap";
}

function isSamePeerLocation(left: TunnelPeerLocation, right: TunnelPeerLocation): boolean {
  return (
    left.instanceId === right.instanceId &&
    left.side === right.side &&
    left.nodeId === right.nodeId &&
    left.sessionId === right.sessionId
  );
}

export class TunnelRelayCoordinator {
  public constructor(
    private readonly nodeId: string,
    private readonly peerRegistry: TunnelPeerRegistry,
    private readonly frameTransport: TunnelFrameTransport,
  ) {}

  public attachPeer(input: {
    instanceId: string;
    side: TunnelPeerSide;
    socket: TunnelPeerSocket;
  }): TunnelPeerLocation {
    const location: TunnelPeerLocation = {
      instanceId: input.instanceId,
      side: input.side,
      nodeId: this.nodeId,
      sessionId: randomUUID(),
    };

    this.frameTransport.registerLocalPeer({
      location,
      socket: input.socket,
    });

    const replacedPeer = this.peerRegistry.setPeer(location);
    if (replacedPeer !== undefined) {
      this.frameTransport.closePeer({
        target: replacedPeer,
        closeCode: CloseCodes.REPLACED,
        closeReason: "Replaced by newer sandbox tunnel connection.",
      });
    }

    return location;
  }

  public isCurrentPeer(input: TunnelPeerLocation): boolean {
    const current = this.peerRegistry.getPeer({
      instanceId: input.instanceId,
      side: input.side,
    });
    if (current === undefined) {
      return false;
    }

    return isSamePeerLocation(current, input);
  }

  public async forwardPeerMessage(input: {
    instanceId: string;
    fromSide: TunnelPeerSide;
    payload: TunnelFramePayload;
  }): Promise<void> {
    const target = this.peerRegistry.getPeer({
      instanceId: input.instanceId,
      side: getOppositeSide(input.fromSide),
    });
    if (target === undefined) {
      return;
    }

    await this.frameTransport.forwardToPeer({
      target,
      payload: input.payload,
    });
  }

  public detachPeer(input: TunnelPeerLocation): void {
    this.frameTransport.unregisterLocalPeer({
      location: input,
    });

    const removed = this.peerRegistry.removePeer(input);
    if (!removed) {
      return;
    }

    if (input.side === "connection") {
      return;
    }

    const opposite = this.peerRegistry.getPeer({
      instanceId: input.instanceId,
      side: getOppositeSide(input.side),
    });
    if (opposite === undefined) {
      return;
    }

    this.frameTransport.closePeer({
      target: opposite,
      closeCode: CloseCodes.PEER_DISCONNECTED,
      closeReason: "Sandbox tunnel peer disconnected.",
    });
  }

  public getPeer(input: TunnelPeerDescriptor): TunnelPeerLocation | undefined {
    return this.peerRegistry.getPeer(input);
  }
}
