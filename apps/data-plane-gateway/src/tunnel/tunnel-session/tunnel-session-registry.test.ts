import { describe, expect, it } from "vitest";

import { InMemoryTunnelSessionRegistryAdapter } from "./adapters/in-memory-tunnel-session-registry-adapter.js";
import { TunnelSessionRegistry } from "./tunnel-session-registry.js";

describe("TunnelSessionRegistry", () => {
  it("delegates bootstrap target and binding operations through the configured adapter", () => {
    const registry = new TunnelSessionRegistry(new InMemoryTunnelSessionRegistryAdapter());

    registry.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });
    const binding = registry.bindClientStream({
      sandboxInstanceId: "sbi_test",
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });

    expect(
      registry.getBootstrapTarget({
        sandboxInstanceId: "sbi_test",
      }),
    ).toEqual({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });
    expect(
      registry.getBindingByClientStream({
        sandboxInstanceId: "sbi_test",
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).toEqual(binding);
    expect(
      registry.unbindClientStream({
        sandboxInstanceId: "sbi_test",
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).toEqual(binding);
  });
});
