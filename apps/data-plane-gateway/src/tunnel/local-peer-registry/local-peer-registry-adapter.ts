import type { RelayTarget, SessionPeerDescriptor } from "../types.js";

export interface LocalPeerRegistryAdapter {
  getBootstrapPeer(input: { sandboxInstanceId: string }): RelayTarget | undefined;
  setBootstrapPeer(input: RelayTarget): RelayTarget | undefined;
  getConnectionPeer(input: SessionPeerDescriptor): RelayTarget | undefined;
  setConnectionPeer(input: RelayTarget): RelayTarget | undefined;
  listConnectionPeers(input: { sandboxInstanceId: string }): RelayTarget[];
  removePeer(input: RelayTarget): boolean;
}
