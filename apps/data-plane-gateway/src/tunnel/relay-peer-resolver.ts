import type { RelayPeerSide, RelayTarget } from "./types.js";

export interface RelayPeerResolver {
  resolveBootstrapPeer(input: {
    sandboxInstanceId: string;
    targetSessionId?: string;
  }): Promise<RelayTarget | undefined>;
  resolveConnectionPeer(input: {
    sandboxInstanceId: string;
    sessionId: string;
  }): Promise<RelayTarget | undefined>;
  resolveSessionPeer(input: {
    sandboxInstanceId: string;
    side: RelayPeerSide;
    sessionId: string;
  }): Promise<RelayTarget | undefined>;
}
