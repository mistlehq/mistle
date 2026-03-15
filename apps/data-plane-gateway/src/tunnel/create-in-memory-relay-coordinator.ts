import { InMemoryLocalPeerRegistryAdapter } from "./local-peer-registry/adapters/in-memory-local-peer-registry-adapter.js";
import { TunnelRelayCoordinator } from "./relay-coordinator.js";
import { InMemoryRelayTransportAdapter } from "./relay-transport/adapters/in-memory-relay-transport-adapter.js";

export function createInMemoryTunnelRelayCoordinator(nodeId: string): TunnelRelayCoordinator {
  const peerRegistryAdapter = new InMemoryLocalPeerRegistryAdapter();
  const relayTransportAdapter = new InMemoryRelayTransportAdapter(nodeId);

  return new TunnelRelayCoordinator(nodeId, peerRegistryAdapter, relayTransportAdapter);
}
