import type { TunnelPeerDescriptor, TunnelPeerLocation } from "../types.js";

export interface TunnelPeerRegistryAdapter {
  getPeer(input: TunnelPeerDescriptor): TunnelPeerLocation | undefined;
  setPeer(input: TunnelPeerLocation): TunnelPeerLocation | undefined;
  removePeer(input: TunnelPeerLocation): boolean;
}
