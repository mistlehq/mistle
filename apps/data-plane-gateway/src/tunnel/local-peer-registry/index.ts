import type { LocalPeerDescriptor, RelayTarget } from "../types.js";
import type { LocalPeerRegistryAdapter } from "./local-peer-registry-adapter.js";

export class LocalPeerRegistry {
  public constructor(private readonly adapter: LocalPeerRegistryAdapter) {}

  public getPeer(input: LocalPeerDescriptor): RelayTarget | undefined {
    return this.adapter.getPeer(input);
  }

  public setPeer(input: RelayTarget): RelayTarget | undefined {
    return this.adapter.setPeer(input);
  }

  public removePeer(input: RelayTarget): boolean {
    return this.adapter.removePeer(input);
  }
}
