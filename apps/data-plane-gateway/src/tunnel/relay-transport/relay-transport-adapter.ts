import type { RelayEnvelope, RelayPeerSocket, RelayTarget } from "../types.js";

export interface RelayTransportAdapter {
  registerLocalPeer(input: { target: RelayTarget; socket: RelayPeerSocket }): void;
  unregisterLocalPeer(input: { target: RelayTarget }): void;
  deliverEnvelope(envelope: RelayEnvelope): Promise<void>;
}
