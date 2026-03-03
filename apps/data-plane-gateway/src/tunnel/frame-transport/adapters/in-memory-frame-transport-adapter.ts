import type { TunnelFramePayload, TunnelPeerLocation, TunnelPeerSocket } from "../../types.js";
import type { TunnelFrameTransportAdapter } from "../frame-transport-adapter.js";

export class InMemoryTunnelFrameTransportAdapter implements TunnelFrameTransportAdapter {
  private readonly socketsBySessionId = new Map<string, TunnelPeerSocket>();

  public constructor(private readonly nodeId: string) {}

  public registerLocalPeer(input: {
    location: TunnelPeerLocation;
    socket: TunnelPeerSocket;
  }): void {
    if (input.location.nodeId !== this.nodeId) {
      throw new Error("Expected local peer registration to target current gateway node.");
    }

    this.socketsBySessionId.set(input.location.sessionId, input.socket);
  }

  public unregisterLocalPeer(input: { location: TunnelPeerLocation }): void {
    if (input.location.nodeId !== this.nodeId) {
      return;
    }
    this.socketsBySessionId.delete(input.location.sessionId);
  }

  public async forwardToPeer(input: {
    target: TunnelPeerLocation;
    payload: TunnelFramePayload;
  }): Promise<void> {
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

  public closePeer(input: {
    target: TunnelPeerLocation;
    closeCode: number;
    closeReason: string;
  }): void {
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
