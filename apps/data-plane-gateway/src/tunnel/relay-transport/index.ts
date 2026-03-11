import type { RelayEnvelope, RelayPeerSocket, RelayTarget } from "../types.js";
import type { RelayTransportAdapter } from "./relay-transport-adapter.js";

export class RelayTransport {
  public constructor(private readonly adapter: RelayTransportAdapter) {}

  public registerLocalPeer(input: { target: RelayTarget; socket: RelayPeerSocket }): void {
    this.adapter.registerLocalPeer(input);
  }

  public unregisterLocalPeer(input: { target: RelayTarget }): void {
    this.adapter.unregisterLocalPeer(input);
  }

  public async deliverEnvelope(envelope: RelayEnvelope): Promise<void> {
    await this.adapter.deliverEnvelope(envelope);
  }
}
