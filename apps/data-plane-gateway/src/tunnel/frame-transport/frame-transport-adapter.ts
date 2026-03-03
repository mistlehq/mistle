import type { TunnelFramePayload, TunnelPeerLocation, TunnelPeerSocket } from "../types.js";

export interface TunnelFrameTransportAdapter {
  registerLocalPeer(input: { location: TunnelPeerLocation; socket: TunnelPeerSocket }): void;
  unregisterLocalPeer(input: { location: TunnelPeerLocation }): void;
  forwardToPeer(input: { target: TunnelPeerLocation; payload: TunnelFramePayload }): Promise<void>;
  closePeer(input: { target: TunnelPeerLocation; closeCode: number; closeReason: string }): void;
}
