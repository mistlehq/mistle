import type { TunnelPeerDescriptor, TunnelPeerLocation } from "../types.js";
import type { TunnelPeerRegistryAdapter } from "./peer-registry-adapter.js";

export class TunnelPeerRegistry {
  public constructor(private readonly adapter: TunnelPeerRegistryAdapter) {}

  public getPeer(input: TunnelPeerDescriptor): TunnelPeerLocation | undefined {
    return this.adapter.getPeer(input);
  }

  public setPeer(input: TunnelPeerLocation): TunnelPeerLocation | undefined {
    return this.adapter.setPeer(input);
  }

  public removePeer(input: TunnelPeerLocation): boolean {
    return this.adapter.removePeer(input);
  }
}
