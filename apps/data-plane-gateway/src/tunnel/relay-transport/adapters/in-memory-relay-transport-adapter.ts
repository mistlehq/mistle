import type { RelayPayload, RelayPeerSocket, RelayTarget } from "../../types.js";
import type { RelayTransportAdapter } from "../relay-transport-adapter.js";

export class InMemoryRelayTransportAdapter implements RelayTransportAdapter {
  private readonly socketsBySessionId = new Map<string, RelayPeerSocket>();

  public constructor(private readonly nodeId: string) {}

  public registerLocalPeer(input: { target: RelayTarget; socket: RelayPeerSocket }): void {
    if (input.target.nodeId !== this.nodeId) {
      throw new Error("Expected local peer registration to target current gateway node.");
    }

    this.socketsBySessionId.set(input.target.sessionId, input.socket);
  }

  public unregisterLocalPeer(input: { target: RelayTarget }): void {
    if (input.target.nodeId !== this.nodeId) {
      return;
    }
    this.socketsBySessionId.delete(input.target.sessionId);
  }

  public async forwardToPeer(input: { target: RelayTarget; payload: RelayPayload }): Promise<void> {
    if (input.target.nodeId !== this.nodeId) {
      throw new Error("Expected in-memory frame transport target to be local.");
    }

    const socket = this.socketsBySessionId.get(input.target.sessionId);
    if (socket === undefined) {
      return;
    }
    if (socket.readyState !== 1) {
      return;
    }

    socket.send(input.payload);
  }

  public closePeer(input: { target: RelayTarget; closeCode: number; closeReason: string }): void {
    if (input.target.nodeId !== this.nodeId) {
      return;
    }

    const socket = this.socketsBySessionId.get(input.target.sessionId);
    if (socket === undefined) {
      return;
    }
    if (socket.readyState !== 1) {
      return;
    }

    socket.close(input.closeCode, input.closeReason);
  }
}
