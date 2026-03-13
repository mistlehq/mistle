import { describe, expect, it } from "vitest";

import { InMemoryTunnelSessionRegistryAdapter } from "../../tunnel-session/adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "../../tunnel-session/index.js";
import { GatewayForwardingServer } from "../gateway-forwarding-server.js";
import { LocalGatewayForwardingClientAdapter } from "./local-gateway-forwarding-client-adapter.js";
import { LocalGatewayForwardingServerAdapter } from "./local-gateway-forwarding-server-adapter.js";

describe("LocalGatewayForwardingClientAdapter", () => {
  it("dispatches local forwarding operations through the server", async () => {
    const registry = new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter());
    registry.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });
    const server = new GatewayForwardingServer(new LocalGatewayForwardingServerAdapter(registry));
    const client = new LocalGatewayForwardingClientAdapter("dpg_test", server);

    await expect(
      client.openInteractiveStream(
        {
          sourceNodeId: "dpg_test",
          targetNodeId: "dpg_remote",
        },
        {
          sandboxInstanceId: "sbi_test",
          channelKind: "pty",
          clientSessionId: "conn_1",
          clientStreamId: 7,
        },
      ),
    ).rejects.toThrow("Local forwarding client can only target node");

    await expect(
      client.openInteractiveStream(
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
      ),
    ).resolves.toEqual({
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
  });
});
