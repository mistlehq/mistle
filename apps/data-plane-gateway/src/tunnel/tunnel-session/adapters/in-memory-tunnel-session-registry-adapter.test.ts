import { describe, expect, it } from "vitest";

import { InMemoryTunnelSessionRegistryAdapter } from "./in-memory-tunnel-session-registry-adapter.js";

describe("InMemoryTunnelSessionRegistryAdapter", () => {
  it("replaces the bootstrap session for a sandbox instance and releases prior bindings", () => {
    const adapter = new InMemoryTunnelSessionRegistryAdapter();

    const firstAttach = adapter.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap_1",
    });
    const firstBinding = adapter.bindClientStream({
      sandboxInstanceId: "sbi_test",
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });

    const secondAttach = adapter.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap_2",
    });

    expect(firstAttach).toEqual({
      replacedBootstrapTarget: undefined,
      releasedBindings: [],
    });
    expect(secondAttach).toEqual({
      replacedBootstrapTarget: {
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "sess_bootstrap_1",
      },
      releasedBindings: [firstBinding],
    });
    expect(
      adapter.getBootstrapTarget({
        sandboxInstanceId: "sbi_test",
      }),
    ).toEqual({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap_2",
    });
  });

  it("binds, looks up, and unbinds client streams for the current bootstrap session", () => {
    const adapter = new InMemoryTunnelSessionRegistryAdapter();
    adapter.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });

    const firstBinding = adapter.bindClientStream({
      sandboxInstanceId: "sbi_test",
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });
    const secondBinding = adapter.bindClientStream({
      sandboxInstanceId: "sbi_test",
      channelKind: "agent",
      clientSessionId: "conn_2",
      clientStreamId: 8,
    });

    expect(firstBinding).toEqual({
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 7,
      tunnelStreamId: 1,
    });
    expect(secondBinding).toEqual({
      channelKind: "agent",
      clientSessionId: "conn_2",
      clientStreamId: 8,
      tunnelStreamId: 2,
    });
    expect(
      adapter.getBindingByClientStream({
        sandboxInstanceId: "sbi_test",
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).toEqual(firstBinding);
    expect(
      adapter.getBindingByTunnelStreamId({
        sandboxInstanceId: "sbi_test",
        tunnelStreamId: 2,
      }),
    ).toEqual(secondBinding);
    expect(
      adapter.unbindClientStream({
        sandboxInstanceId: "sbi_test",
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).toEqual(firstBinding);
    expect(
      adapter.getBindingByTunnelStreamId({
        sandboxInstanceId: "sbi_test",
        tunnelStreamId: firstBinding.tunnelStreamId,
      }),
    ).toBeUndefined();
  });

  it("fails fast when binding a client stream without a live bootstrap session", () => {
    const adapter = new InMemoryTunnelSessionRegistryAdapter();

    expect(() =>
      adapter.bindClientStream({
        sandboxInstanceId: "sbi_missing",
        channelKind: "pty",
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).toThrow("Bootstrap tunnel session is not registered");
  });

  it("only detaches the currently registered bootstrap session", () => {
    const adapter = new InMemoryTunnelSessionRegistryAdapter();
    adapter.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap_1",
    });
    const binding = adapter.bindClientStream({
      sandboxInstanceId: "sbi_test",
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });

    expect(
      adapter.detachBootstrapSession({
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "stale_session",
      }),
    ).toBeUndefined();
    expect(
      adapter.detachBootstrapSession({
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "sess_bootstrap_1",
      }),
    ).toEqual({
      bootstrapTarget: {
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "sess_bootstrap_1",
      },
      releasedBindings: [binding],
    });
    expect(
      adapter.getBootstrapTarget({
        sandboxInstanceId: "sbi_test",
      }),
    ).toBeUndefined();
  });

  it("releases all bindings for one client session without affecting others", () => {
    const adapter = new InMemoryTunnelSessionRegistryAdapter();
    adapter.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap_1",
    });
    const firstReleasedBinding = adapter.bindClientStream({
      sandboxInstanceId: "sbi_test",
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });
    const secondReleasedBinding = adapter.bindClientStream({
      sandboxInstanceId: "sbi_test",
      channelKind: "agent",
      clientSessionId: "conn_1",
      clientStreamId: 8,
    });
    const remainingBinding = adapter.bindClientStream({
      sandboxInstanceId: "sbi_test",
      channelKind: "pty",
      clientSessionId: "conn_2",
      clientStreamId: 9,
    });

    expect(
      adapter.releaseClientSessionBindings({
        sandboxInstanceId: "sbi_test",
        clientSessionId: "conn_1",
      }),
    ).toEqual([firstReleasedBinding, secondReleasedBinding]);
    expect(
      adapter.getBindingByTunnelStreamId({
        sandboxInstanceId: "sbi_test",
        tunnelStreamId: remainingBinding.tunnelStreamId,
      }),
    ).toEqual(remainingBinding);
  });
});
