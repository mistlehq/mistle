import { describe, expect, it } from "vitest";

import { SandboxTunnelSession } from "./sandbox-tunnel-session.js";

describe("SandboxTunnelSession", () => {
  it("binds client streams to monotonically increasing tunnel stream ids", () => {
    const session = new SandboxTunnelSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });

    const firstBinding = session.bindClientStream({
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });
    const secondBinding = session.bindClientStream({
      clientSessionId: "conn_2",
      clientStreamId: 8,
    });

    expect(firstBinding).toEqual({
      clientSessionId: "conn_1",
      clientStreamId: 7,
      tunnelStreamId: 1,
    });
    expect(secondBinding).toEqual({
      clientSessionId: "conn_2",
      clientStreamId: 8,
      tunnelStreamId: 2,
    });
    expect(
      session.getBindingByClientStream({
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).toEqual(firstBinding);
    expect(session.getBindingByTunnelStreamId(2)).toEqual(secondBinding);
  });

  it("rejects duplicate client stream bindings", () => {
    const session = new SandboxTunnelSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });

    session.bindClientStream({
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });

    expect(() =>
      session.bindClientStream({
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).toThrow("Client stream binding already exists");
  });

  it("unbinds and releases stream bindings", () => {
    const session = new SandboxTunnelSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });

    const binding = session.bindClientStream({
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });
    session.bindClientStream({
      clientSessionId: "conn_2",
      clientStreamId: 8,
    });

    expect(
      session.unbindClientStream({
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).toEqual(binding);
    expect(session.getBindingByTunnelStreamId(binding.tunnelStreamId)).toBeUndefined();
    expect(session.bindingCount).toBe(1);

    expect(session.releaseAllBindings()).toEqual([
      {
        clientSessionId: "conn_2",
        clientStreamId: 8,
        tunnelStreamId: 2,
      },
    ]);
    expect(session.bindingCount).toBe(0);
  });
});
