import type { LocalPeerDescriptor, RelayTarget } from "../../types.js";
import type { LocalPeerRegistryAdapter } from "../local-peer-registry-adapter.js";

function createPeerKey(input: LocalPeerDescriptor): string {
  return `${input.sandboxInstanceId}:${input.side}`;
}

export class InMemoryLocalPeerRegistryAdapter implements LocalPeerRegistryAdapter {
  private readonly peersByKey = new Map<string, RelayTarget>();

  public getPeer(input: LocalPeerDescriptor): RelayTarget | undefined {
    return this.peersByKey.get(createPeerKey(input));
  }

  public setPeer(input: RelayTarget): RelayTarget | undefined {
    const key = createPeerKey(input);
    const previous = this.peersByKey.get(key);
    this.peersByKey.set(key, input);
    return previous;
  }

  public removePeer(input: RelayTarget): boolean {
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
