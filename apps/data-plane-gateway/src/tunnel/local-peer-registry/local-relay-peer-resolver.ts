import type { RelayPeerResolver } from "../relay-peer-resolver.js";
import type { RelayTarget } from "../types.js";
import type { LocalPeerRegistryAdapter } from "./local-peer-registry-adapter.js";

export class LocalRelayPeerResolver implements RelayPeerResolver {
  public constructor(private readonly peerRegistry: LocalPeerRegistryAdapter) {}

  public async resolveBootstrapPeer(input: {
    sandboxInstanceId: string;
    targetSessionId?: string;
  }): Promise<RelayTarget | undefined> {
    const target = this.peerRegistry.getBootstrapPeer({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (target === undefined) {
      return undefined;
    }
    if (input.targetSessionId !== undefined && target.sessionId !== input.targetSessionId) {
      return undefined;
    }

    return target;
  }

  public async resolveConnectionPeer(input: {
    sandboxInstanceId: string;
    sessionId: string;
  }): Promise<RelayTarget | undefined> {
    return this.peerRegistry.getConnectionPeer({
      sandboxInstanceId: input.sandboxInstanceId,
      side: "connection",
      sessionId: input.sessionId,
    });
  }
}
