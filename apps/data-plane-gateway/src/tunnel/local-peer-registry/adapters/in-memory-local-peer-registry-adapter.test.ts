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
  it("stores the bootstrap peer by sandbox instance", () => {
    const adapter = new InMemoryLocalPeerRegistryAdapter();
    const bootstrapLocation = createPeerLocation({
      sandboxInstanceId: "sbi_abc",
      side: "bootstrap",
      nodeId: "dpg_1",
      sessionId: "session_bootstrap",
    });

    adapter.setBootstrapPeer(bootstrapLocation);

    expect(
      adapter.getBootstrapPeer({
        sandboxInstanceId: "sbi_abc",
      }),
    ).toEqual(bootstrapLocation);
  });

  it("stores multiple connection peers for the same sandbox instance", () => {
    const adapter = new InMemoryLocalPeerRegistryAdapter();
    const firstConnectionLocation = createPeerLocation({
      sandboxInstanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_1",
      sessionId: "session_one",
    });
    const secondConnectionLocation = createPeerLocation({
      sandboxInstanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_1",
      sessionId: "session_two",
    });

    adapter.setConnectionPeer(firstConnectionLocation);
    adapter.setConnectionPeer(secondConnectionLocation);

    expect(
      adapter.getConnectionPeer({
        sandboxInstanceId: "sbi_abc",
        side: "connection",
        sessionId: "session_one",
      }),
    ).toEqual(firstConnectionLocation);
    expect(
      adapter.getConnectionPeer({
        sandboxInstanceId: "sbi_abc",
        side: "connection",
        sessionId: "session_two",
      }),
    ).toEqual(secondConnectionLocation);
    expect(
      adapter.listConnectionPeers({
        sandboxInstanceId: "sbi_abc",
      }),
    ).toEqual([firstConnectionLocation, secondConnectionLocation]);
  });

  it("returns the previous bootstrap peer when replacing it", () => {
    const adapter = new InMemoryLocalPeerRegistryAdapter();
    const previousLocation = createPeerLocation({
      sandboxInstanceId: "sbi_abc",
      side: "bootstrap",
      nodeId: "dpg_1",
      sessionId: "session_one",
    });
    const nextLocation = createPeerLocation({
      sandboxInstanceId: "sbi_abc",
      side: "bootstrap",
      nodeId: "dpg_2",
      sessionId: "session_two",
    });

    expect(adapter.setBootstrapPeer(previousLocation)).toBeUndefined();
    expect(adapter.setBootstrapPeer(nextLocation)).toEqual(previousLocation);
    expect(
      adapter.getBootstrapPeer({
        sandboxInstanceId: "sbi_abc",
      }),
    ).toEqual(nextLocation);
  });

  it("only removes the peer when node id and session id match", () => {
    const adapter = new InMemoryLocalPeerRegistryAdapter();
    const storedBootstrapLocation = createPeerLocation({
      sandboxInstanceId: "sbi_abc",
      side: "bootstrap",
      nodeId: "dpg_1",
      sessionId: "session_bootstrap",
    });
    const storedConnectionLocation = createPeerLocation({
      sandboxInstanceId: "sbi_abc",
      side: "connection",
      nodeId: "dpg_1",
      sessionId: "session_connection",
    });

    adapter.setBootstrapPeer(storedBootstrapLocation);
    adapter.setConnectionPeer(storedConnectionLocation);

    expect(
      adapter.removePeer(
        createPeerLocation({
          sandboxInstanceId: "sbi_abc",
          side: "bootstrap",
          nodeId: "dpg_2",
          sessionId: "session_bootstrap",
        }),
      ),
    ).toBe(false);
    expect(
      adapter.removePeer(
        createPeerLocation({
          sandboxInstanceId: "sbi_abc",
          side: "connection",
          nodeId: "dpg_1",
          sessionId: "session_other",
        }),
      ),
    ).toBe(false);
    expect(adapter.removePeer(storedBootstrapLocation)).toBe(true);
    expect(adapter.removePeer(storedConnectionLocation)).toBe(true);
    expect(
      adapter.getBootstrapPeer({
        sandboxInstanceId: "sbi_abc",
      }),
    ).toBeUndefined();
    expect(
      adapter.listConnectionPeers({
        sandboxInstanceId: "sbi_abc",
      }),
    ).toEqual([]);
  });
});
