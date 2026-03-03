import type { TunnelFramePayload, TunnelPeerLocation, TunnelPeerSocket } from "../types.js";
import type { TunnelFrameTransportAdapter } from "./frame-transport-adapter.js";

export class TunnelFrameTransport {
  public constructor(private readonly adapter: TunnelFrameTransportAdapter) {}

  public registerLocalPeer(input: {
    location: TunnelPeerLocation;
    socket: TunnelPeerSocket;
  }): void {
    this.adapter.registerLocalPeer(input);
  }

  public unregisterLocalPeer(input: { location: TunnelPeerLocation }): void {
    this.adapter.unregisterLocalPeer(input);
  }

  public async forwardToPeer(input: {
    target: TunnelPeerLocation;
    payload: TunnelFramePayload;
  }): Promise<void> {
    await this.adapter.forwardToPeer(input);
  }

  public closePeer(input: {
    target: TunnelPeerLocation;
    closeCode: number;
    closeReason: string;
  }): void {
    this.adapter.closePeer(input);
  }
}
