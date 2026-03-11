import { InMemoryTunnelFrameTransportAdapter } from "./frame-transport/adapters/in-memory-frame-transport-adapter.js";
import { TunnelFrameTransport } from "./frame-transport/index.js";
import { InMemoryTunnelPeerRegistryAdapter } from "./peer-registry/adapters/in-memory-peer-registry-adapter.js";
import { TunnelPeerRegistry } from "./peer-registry/index.js";
import { TunnelRelayCoordinator } from "./relay-coordinator.js";

export function createInMemoryTunnelRelayCoordinator(nodeId: string): TunnelRelayCoordinator {
  const peerRegistryAdapter = new InMemoryTunnelPeerRegistryAdapter();
  const peerRegistry = new TunnelPeerRegistry(peerRegistryAdapter);
  const frameTransportAdapter = new InMemoryTunnelFrameTransportAdapter(nodeId);
  const frameTransport = new TunnelFrameTransport(frameTransportAdapter);

  return new TunnelRelayCoordinator(nodeId, peerRegistry, frameTransport);
}
