import type { RelayTarget } from "./types.js";

export interface RelayPeerResolver {
  resolveBootstrapPeer(input: {
    sandboxInstanceId: string;
    targetSessionId?: string;
  }): Promise<RelayTarget | undefined>;
  resolveConnectionPeer(input: {
    sandboxInstanceId: string;
    sessionId: string;
  }): Promise<RelayTarget | undefined>;
}
