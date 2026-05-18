import { WebSocket } from "ws";

import type { RelayEnvelope, RelayPeerSocket, RelayTarget } from "../../types.js";
import type { RelayTransportAdapter } from "../relay-transport-adapter.js";

export class InMemoryRelayTransportAdapter implements RelayTransportAdapter {
  private readonly socketsByPeerKey = new Map<string, RelayPeerSocket>();

  public constructor(private readonly nodeId: string) {}

  public registerLocalPeer(input: { target: RelayTarget; socket: RelayPeerSocket }): void {
    if (input.target.nodeId !== this.nodeId) {
      throw new Error("Expected local peer registration to target current gateway node.");
    }

    this.socketsByPeerKey.set(createPeerKey(input.target), input.socket);
  }

  public unregisterLocalPeer(input: { target: RelayTarget }): void {
    if (input.target.nodeId !== this.nodeId) {
      return;
    }
    this.socketsByPeerKey.delete(createPeerKey(input.target));
  }

  public async deliverEnvelope(envelope: RelayEnvelope): Promise<void> {
    if (envelope.target.nodeId !== this.nodeId) {
      throw new Error("Expected in-memory relay transport target to be local.");
    }

    const socket = this.socketsByPeerKey.get(createPeerKey(envelope.target));
    if (socket === undefined) {
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (envelope.kind === "frame") {
      socket.send(envelope.payload);
      return;
    }

    socket.close(envelope.closeCode, envelope.closeReason);
  }
}

function createPeerKey(target: RelayTarget): string {
  return `${target.side}:${target.sessionId}`;
}
