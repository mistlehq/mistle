import type { RelayPayload, RelayPeerSocket, RelayTarget } from "../types.js";
import type { RelayTransportAdapter } from "./relay-transport-adapter.js";

export class RelayTransport {
  public constructor(private readonly adapter: RelayTransportAdapter) {}

  public registerLocalPeer(input: { target: RelayTarget; socket: RelayPeerSocket }): void {
    this.adapter.registerLocalPeer(input);
  }

  public unregisterLocalPeer(input: { target: RelayTarget }): void {
    this.adapter.unregisterLocalPeer(input);
  }

  public async forwardToPeer(input: { target: RelayTarget; payload: RelayPayload }): Promise<void> {
    await this.adapter.forwardToPeer(input);
  }

  public closePeer(input: { target: RelayTarget; closeCode: number; closeReason: string }): void {
    this.adapter.closePeer(input);
  }
}
