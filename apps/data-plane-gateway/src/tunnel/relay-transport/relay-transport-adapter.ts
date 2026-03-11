import type { RelayPayload, RelayPeerSocket, RelayTarget } from "../types.js";

export interface RelayTransportAdapter {
  registerLocalPeer(input: { target: RelayTarget; socket: RelayPeerSocket }): void;
  unregisterLocalPeer(input: { target: RelayTarget }): void;
  forwardToPeer(input: { target: RelayTarget; payload: RelayPayload }): Promise<void>;
  closePeer(input: { target: RelayTarget; closeCode: number; closeReason: string }): void;
}
