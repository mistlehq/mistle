import type { RelayTarget, SessionPeerDescriptor } from "../../types.js";
import type { LocalPeerRegistryAdapter } from "../local-peer-registry-adapter.js";

function createBootstrapPeerKey(input: { sandboxInstanceId: string }): string {
  return `${input.sandboxInstanceId}:bootstrap`;
}

function createConnectionPeerKey(input: { sandboxInstanceId: string; sessionId: string }): string {
  return `${input.sandboxInstanceId}:connection:${input.sessionId}`;
}

export class InMemoryLocalPeerRegistryAdapter implements LocalPeerRegistryAdapter {
  private readonly bootstrapPeersByKey = new Map<string, RelayTarget>();
  private readonly connectionPeersByKey = new Map<string, RelayTarget>();

  public getBootstrapPeer(input: { sandboxInstanceId: string }): RelayTarget | undefined {
    return this.bootstrapPeersByKey.get(createBootstrapPeerKey(input));
  }

  public setBootstrapPeer(input: RelayTarget): RelayTarget | undefined {
    const key = createBootstrapPeerKey(input);
    const previous = this.bootstrapPeersByKey.get(key);
    this.bootstrapPeersByKey.set(key, input);
    return previous;
  }

  public getConnectionPeer(input: SessionPeerDescriptor): RelayTarget | undefined {
    return this.connectionPeersByKey.get(createConnectionPeerKey(input));
  }

  public setConnectionPeer(input: RelayTarget): RelayTarget | undefined {
    const key = createConnectionPeerKey(input);
    const previous = this.connectionPeersByKey.get(key);
    this.connectionPeersByKey.set(key, input);
    return previous;
  }

  public listConnectionPeers(input: { sandboxInstanceId: string }): RelayTarget[] {
    const peers: RelayTarget[] = [];
    for (const [key, peer] of this.connectionPeersByKey.entries()) {
      if (!key.startsWith(`${input.sandboxInstanceId}:connection:`)) {
        continue;
      }
      peers.push(peer);
    }

    return peers;
  }

  public removePeer(input: RelayTarget): boolean {
    const key =
      input.side === "bootstrap" ? createBootstrapPeerKey(input) : createConnectionPeerKey(input);
    const peersByKey =
      input.side === "bootstrap" ? this.bootstrapPeersByKey : this.connectionPeersByKey;
    const existing = peersByKey.get(key);
    if (existing === undefined) {
      return false;
    }
    if (existing.nodeId !== input.nodeId || existing.sessionId !== input.sessionId) {
      return false;
    }

    peersByKey.delete(key);
    return true;
  }
}
