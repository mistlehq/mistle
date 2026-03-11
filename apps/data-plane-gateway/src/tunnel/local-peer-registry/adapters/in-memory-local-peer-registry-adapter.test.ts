import { describe, expect, it } from "vitest";

import type { RelayTarget } from "../../types.js";
import { InMemoryLocalPeerRegistryAdapter } from "./in-memory-local-peer-registry-adapter.js";

function createPeerLocation(input: {
  sandboxInstanceId: string;
  side: RelayTarget["side"];
  nodeId: string;
  sessionId: string;
}): RelayTarget {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    side: input.side,
    nodeId: input.nodeId,
    sessionId: input.sessionId,
  };
}

describe("InMemoryLocalPeerRegistryAdapter", () => {
  it("stores and retrieves peers by instance id and side", () => {
    const adapter = new InMemoryLocalPeerRegistryAdapter();
    const bootstrapLocation = createPeerLocation({
      sandboxInstanceId: "sbi_abc",
      side: "bootstrap",
      nodeId: "dpg_1",
      sessionId: "session_bootstrap",
    });
    const connectionLocation = createPeerLocation({
      sandboxInstanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_1",
      sessionId: "session_connection",
    });

    adapter.setPeer(bootstrapLocation);
    adapter.setPeer(connectionLocation);

    expect(
      adapter.getPeer({
        sandboxInstanceId: "sbi_abc",
        side: "bootstrap",
      }),
    ).toEqual(bootstrapLocation);
    expect(
      adapter.getPeer({
        sandboxInstanceId: "sbi_abc",
        side: "connection",
      }),
    ).toEqual(connectionLocation);
  });

  it("returns the previous peer when replacing an existing key", () => {
    const adapter = new InMemoryLocalPeerRegistryAdapter();
    const previousLocation = createPeerLocation({
      sandboxInstanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_1",
      sessionId: "session_one",
    });
    const nextLocation = createPeerLocation({
      sandboxInstanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_2",
      sessionId: "session_two",
    });

    expect(adapter.setPeer(previousLocation)).toBeUndefined();
    expect(adapter.setPeer(nextLocation)).toEqual(previousLocation);
    expect(
      adapter.getPeer({
        sandboxInstanceId: "sbi_abc",
        side: "connection",
      }),
    ).toEqual(nextLocation);
  });

  it("only removes the peer when node id and session id match", () => {
    const adapter = new InMemoryLocalPeerRegistryAdapter();
    const storedLocation = createPeerLocation({
      sandboxInstanceId: "sbi_abc",
      side: "bootstrap",
      nodeId: "dpg_1",
      sessionId: "session_one",
    });

    adapter.setPeer(storedLocation);

    const removeWithWrongNodeId = adapter.removePeer(
      createPeerLocation({
        sandboxInstanceId: "sbi_abc",
        side: "bootstrap",
        nodeId: "dpg_2",
        sessionId: "session_one",
      }),
    );
    const removeWithWrongSessionId = adapter.removePeer(
      createPeerLocation({
        sandboxInstanceId: "sbi_abc",
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
        sandboxInstanceId: "sbi_abc",
        side: "bootstrap",
      }),
    ).toBeUndefined();
  });
});
