import type { RelayTarget, SessionPeerDescriptor } from "../types.js";
import type { LocalPeerRegistryAdapter } from "./local-peer-registry-adapter.js";

export class LocalPeerRegistry {
  public constructor(private readonly adapter: LocalPeerRegistryAdapter) {}

  public getBootstrapPeer(input: { sandboxInstanceId: string }): RelayTarget | undefined {
    return this.adapter.getBootstrapPeer(input);
  }

  public setBootstrapPeer(input: RelayTarget): RelayTarget | undefined {
    return this.adapter.setBootstrapPeer(input);
  }

  public getConnectionPeer(input: SessionPeerDescriptor): RelayTarget | undefined {
    return this.adapter.getConnectionPeer(input);
  }

  public setConnectionPeer(input: RelayTarget): RelayTarget | undefined {
    return this.adapter.setConnectionPeer(input);
  }

  public listConnectionPeers(input: { sandboxInstanceId: string }): RelayTarget[] {
    return this.adapter.listConnectionPeers(input);
  }

  public removePeer(input: RelayTarget): boolean {
    return this.adapter.removePeer(input);
  }
}
