import { describe, expect, it } from "vitest";

import { InMemoryTunnelSessionRegistryAdapter } from "../../tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import {
  ClientSessionActiveStreamError,
  TunnelSessionRegistry,
} from "../../tunnel-session/index.js";
import { LocalGatewayForwardingServerAdapter } from "./local-gateway-forwarding-server-adapter.js";

describe("LocalGatewayForwardingServerAdapter", () => {
  it("opens, looks up, closes, and releases interactive streams against the local registry", async () => {
    const registry = new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter());
    registry.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });
    const adapter = new LocalGatewayForwardingServerAdapter(registry);

    const openedStream = await adapter.openInteractiveStream(
      {
        sourceNodeId: "dpg_test",
        targetNodeId: "dpg_test",
      },
      {
        sandboxInstanceId: "sbi_test",
        channelKind: "pty",
        clientSessionId: "conn_1",
        clientStreamId: 7,
      },
    );
    const secondOpenedStream = await adapter.openInteractiveStream(
      {
        sourceNodeId: "dpg_test",
        targetNodeId: "dpg_test",
      },
      {
        sandboxInstanceId: "sbi_test",
        channelKind: "agent",
        clientSessionId: "conn_2",
        clientStreamId: 8,
      },
    );

    expect(openedStream).toEqual({
      bootstrapTarget: {
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "sess_bootstrap",
      },
      binding: {
        channelKind: "pty",
        clientSessionId: "conn_1",
        clientStreamId: 7,
        tunnelStreamId: 1,
      },
    });
    expect(
      await adapter.findInteractiveStreamByClient(
        {
          sourceNodeId: "dpg_test",
          targetNodeId: "dpg_test",
        },
        {
          sandboxInstanceId: "sbi_test",
          clientSessionId: "conn_1",
          clientStreamId: 7,
        },
      ),
    ).toEqual(openedStream);
    expect(
      await adapter.findInteractiveStreamByTunnel(
        {
          sourceNodeId: "dpg_test",
          targetNodeId: "dpg_test",
        },
        {
          sandboxInstanceId: "sbi_test",
          tunnelStreamId: 2,
        },
      ),
    ).toEqual(secondOpenedStream);
    expect(
      await adapter.closeInteractiveStream(
        {
          sourceNodeId: "dpg_test",
          targetNodeId: "dpg_test",
        },
        {
          sandboxInstanceId: "sbi_test",
          clientSessionId: "conn_1",
          clientStreamId: 7,
        },
      ),
    ).toEqual(openedStream);
    expect(
      await adapter.releaseClientSessionStreams(
        {
          sourceNodeId: "dpg_test",
          targetNodeId: "dpg_test",
        },
        {
          sandboxInstanceId: "sbi_test",
          clientSessionId: "conn_2",
        },
      ),
    ).toEqual({
      bootstrapTarget: {
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "sess_bootstrap",
      },
      releasedBindings: [secondOpenedStream.binding],
    });
  });

  it("rejects opening a second active stream for the same client session", async () => {
    const registry = new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter());
    registry.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });
    const adapter = new LocalGatewayForwardingServerAdapter(registry);

    await adapter.openInteractiveStream(
      {
        sourceNodeId: "dpg_test",
        targetNodeId: "dpg_test",
      },
      {
        sandboxInstanceId: "sbi_test",
        channelKind: "pty",
        clientSessionId: "conn_1",
        clientStreamId: 7,
      },
    );

    await expect(
      adapter.openInteractiveStream(
        {
          sourceNodeId: "dpg_test",
          targetNodeId: "dpg_test",
        },
        {
          sandboxInstanceId: "sbi_test",
          channelKind: "agent",
          clientSessionId: "conn_1",
          clientStreamId: 8,
        },
      ),
    ).rejects.toThrow(ClientSessionActiveStreamError);
  });
});
