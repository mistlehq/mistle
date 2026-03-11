import type { LocalPeerDescriptor, RelayTarget } from "../types.js";

export interface LocalPeerRegistryAdapter {
  getPeer(input: LocalPeerDescriptor): RelayTarget | undefined;
  setPeer(input: RelayTarget): RelayTarget | undefined;
  removePeer(input: RelayTarget): boolean;
}
