import { InMemoryLocalPeerRegistryAdapter } from "./local-peer-registry/adapters/in-memory-local-peer-registry-adapter.js";
import { LocalPeerRegistry } from "./local-peer-registry/index.js";
import { TunnelRelayCoordinator } from "./relay-coordinator.js";
import { InMemoryRelayTransportAdapter } from "./relay-transport/adapters/in-memory-relay-transport-adapter.js";
import { RelayTransport } from "./relay-transport/index.js";

export function createInMemoryTunnelRelayCoordinator(nodeId: string): TunnelRelayCoordinator {
  const peerRegistryAdapter = new InMemoryLocalPeerRegistryAdapter();
  const peerRegistry = new LocalPeerRegistry(peerRegistryAdapter);
  const relayTransportAdapter = new InMemoryRelayTransportAdapter(nodeId);
  const relayTransport = new RelayTransport(relayTransportAdapter);

  return new TunnelRelayCoordinator(nodeId, peerRegistry, relayTransport);
}
