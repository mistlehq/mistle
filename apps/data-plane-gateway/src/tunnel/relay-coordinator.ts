import { LocalPeerRegistry } from "./local-peer-registry/index.js";
import { RelayTransport } from "./relay-transport/index.js";
import type {
  LocalPeerDescriptor,
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

    const replacedPeer = this.peerRegistry.setPeer(target);
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

    const opposite = this.peerRegistry.getPeer({
      sandboxInstanceId: input.target.sandboxInstanceId,
      side: getOppositeSide(input.target.side),
    });
    if (!input.notifyOppositePeer || opposite === undefined) {
      return;
    }

    void this.relayTransport
      .deliverEnvelope(
        toCloseEnvelope({
          target: opposite,
          closeCode: CloseCodes.PEER_DISCONNECTED,
          closeReason: "Sandbox tunnel peer disconnected.",
        }),
      )
      .catch(() => undefined);
  }

  public getPeer(input: LocalPeerDescriptor): RelayTarget | undefined {
    return this.peerRegistry.getPeer(input);
  }
}
