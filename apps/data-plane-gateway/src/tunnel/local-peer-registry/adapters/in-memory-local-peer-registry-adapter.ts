import type { RelayPeerSide, RelayTarget, SessionPeerDescriptor } from "../../types.js";
import type { LocalPeerRegistryAdapter } from "../local-peer-registry-adapter.js";

function createBootstrapPeerKey(input: { sandboxInstanceId: string }): string {
  return `${input.sandboxInstanceId}:bootstrap`;
}

function createSessionPeerKey(input: {
  sandboxInstanceId: string;
  side: RelayPeerSide;
  sessionId: string;
}): string {
  return `${input.sandboxInstanceId}:${input.side}:${input.sessionId}`;
}

export class InMemoryLocalPeerRegistryAdapter implements LocalPeerRegistryAdapter {
  private readonly bootstrapPeersByKey = new Map<string, RelayTarget>();
  private readonly sessionPeersByKey = new Map<string, RelayTarget>();

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
    return this.getSessionPeer(input);
  }

  public setConnectionPeer(input: RelayTarget): RelayTarget | undefined {
    return this.setSessionPeer(input);
  }

  public getSessionPeer(input: SessionPeerDescriptor): RelayTarget | undefined {
    return this.sessionPeersByKey.get(createSessionPeerKey(input));
  }

  public setSessionPeer(input: RelayTarget): RelayTarget | undefined {
    const key = createSessionPeerKey(input);
    const previous = this.sessionPeersByKey.get(key);
    this.sessionPeersByKey.set(key, input);
    return previous;
  }

  public listConnectionPeers(input: { sandboxInstanceId: string }): RelayTarget[] {
    return this.listSessionPeers({
      sandboxInstanceId: input.sandboxInstanceId,
      side: "connection",
    });
  }

  public listSessionPeers(input: {
    sandboxInstanceId: string;
    side: RelayPeerSide;
  }): RelayTarget[] {
    const peers: RelayTarget[] = [];
    for (const [key, peer] of this.sessionPeersByKey.entries()) {
      if (!key.startsWith(`${input.sandboxInstanceId}:${input.side}:`)) {
        continue;
      }
      peers.push(peer);
    }

    return peers;
  }

  public removePeer(input: RelayTarget): boolean {
    const key =
      input.side === "bootstrap" ? createBootstrapPeerKey(input) : createSessionPeerKey(input);
    const peersByKey =
      input.side === "bootstrap" ? this.bootstrapPeersByKey : this.sessionPeersByKey;
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
