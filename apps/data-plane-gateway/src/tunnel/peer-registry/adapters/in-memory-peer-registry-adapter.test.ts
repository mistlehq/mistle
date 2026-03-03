import { describe, expect, it } from "vitest";

import type { TunnelPeerLocation } from "../../types.js";
import { InMemoryTunnelPeerRegistryAdapter } from "./in-memory-peer-registry-adapter.js";

function createPeerLocation(input: {
  instanceId: string;
  side: TunnelPeerLocation["side"];
  nodeId: string;
  sessionId: string;
}): TunnelPeerLocation {
  return {
    instanceId: input.instanceId,
    side: input.side,
    nodeId: input.nodeId,
    sessionId: input.sessionId,
  };
}

describe("InMemoryTunnelPeerRegistryAdapter", () => {
  it("stores and retrieves peers by instance id and side", () => {
    const adapter = new InMemoryTunnelPeerRegistryAdapter();
    const bootstrapLocation = createPeerLocation({
      instanceId: "sbi_abc",
      side: "bootstrap",
      nodeId: "dpg_1",
      sessionId: "session_bootstrap",
    });
    const connectionLocation = createPeerLocation({
      instanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_1",
      sessionId: "session_connection",
    });

    adapter.setPeer(bootstrapLocation);
    adapter.setPeer(connectionLocation);

    expect(
      adapter.getPeer({
        instanceId: "sbi_abc",
        side: "bootstrap",
      }),
    ).toEqual(bootstrapLocation);
    expect(
      adapter.getPeer({
        instanceId: "sbi_abc",
        side: "connection",
      }),
    ).toEqual(connectionLocation);
  });

  it("returns the previous peer when replacing an existing key", () => {
    const adapter = new InMemoryTunnelPeerRegistryAdapter();
    const previousLocation = createPeerLocation({
      instanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_1",
      sessionId: "session_one",
    });
    const nextLocation = createPeerLocation({
      instanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_2",
      sessionId: "session_two",
    });

    expect(adapter.setPeer(previousLocation)).toBeUndefined();
    expect(adapter.setPeer(nextLocation)).toEqual(previousLocation);
    expect(
      adapter.getPeer({
        instanceId: "sbi_abc",
        side: "connection",
      }),
    ).toEqual(nextLocation);
  });

  it("only removes the peer when node id and session id match", () => {
    const adapter = new InMemoryTunnelPeerRegistryAdapter();
    const storedLocation = createPeerLocation({
      instanceId: "sbi_abc",
      side: "bootstrap",
      nodeId: "dpg_1",
      sessionId: "session_one",
    });

    adapter.setPeer(storedLocation);

    const removeWithWrongNodeId = adapter.removePeer(
      createPeerLocation({
        instanceId: "sbi_abc",
        side: "bootstrap",
        nodeId: "dpg_2",
        sessionId: "session_one",
      }),
    );
    const removeWithWrongSessionId = adapter.removePeer(
      createPeerLocation({
        instanceId: "sbi_abc",
        side: "bootstrap",
        nodeId: "dpg_1",
        sessionId: "session_two",
      }),
    );
    const removeWithMatchingIdentity = adapter.removePeer(storedLocation);

    expect(removeWithWrongNodeId).toBe(false);
    expect(removeWithWrongSessionId).toBe(false);
    expect(removeWithMatchingIdentity).toBe(true);
    expect(
      adapter.getPeer({
        instanceId: "sbi_abc",
        side: "bootstrap",
      }),
    ).toBeUndefined();
  });
});
