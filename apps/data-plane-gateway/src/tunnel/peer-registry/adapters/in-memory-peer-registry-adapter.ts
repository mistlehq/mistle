import type { TunnelPeerDescriptor, TunnelPeerLocation } from "../../types.js";
import type { TunnelPeerRegistryAdapter } from "../peer-registry-adapter.js";

function createPeerKey(input: TunnelPeerDescriptor): string {
  return `${input.instanceId}:${input.side}`;
}

export class InMemoryTunnelPeerRegistryAdapter implements TunnelPeerRegistryAdapter {
  private readonly peersByKey = new Map<string, TunnelPeerLocation>();

  public getPeer(input: TunnelPeerDescriptor): TunnelPeerLocation | undefined {
    return this.peersByKey.get(createPeerKey(input));
  }

  public setPeer(input: TunnelPeerLocation): TunnelPeerLocation | undefined {
    const key = createPeerKey(input);
    const previous = this.peersByKey.get(key);
    this.peersByKey.set(key, input);
    return previous;
  }

  public removePeer(input: TunnelPeerLocation): boolean {
    const key = createPeerKey(input);
    const existing = this.peersByKey.get(key);
    if (existing === undefined) {
      return false;
    }
    if (existing.nodeId !== input.nodeId || existing.sessionId !== input.sessionId) {
      return false;
    }

    this.peersByKey.delete(key);
    return true;
  }
}
