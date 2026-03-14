import { describe, expect, it } from "vitest";

import {
  ClientSessionActiveStreamError,
  SandboxTunnelSession,
  TunnelSessionBindingLimitExceededError,
} from "./sandbox-tunnel-session.js";

describe("SandboxTunnelSession", () => {
  it("binds client streams to monotonically increasing tunnel stream ids", () => {
    const session = new SandboxTunnelSession(
      {
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "sess_bootstrap",
      },
      2,
    );

    const firstBinding = session.bindClientStream({
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });
    const secondBinding = session.bindClientStream({
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
      session.getBindingByClientStream({
        clientSessionId: "conn_1",
        clientStreamId: 7,
      }),
    ).toEqual(firstBinding);
    expect(session.getBindingByTunnelStreamId(2)).toEqual(secondBinding);
  });

  it("unbinds and releases stream bindings", () => {
    const session = new SandboxTunnelSession(
      {
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "sess_bootstrap",
      },
      2,
    );

    const binding = session.bindClientStream({
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });
    session.bindClientStream({
      channelKind: "agent",
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
        channelKind: "agent",
        clientSessionId: "conn_2",
        clientStreamId: 8,
        tunnelStreamId: 2,
      },
    ]);
    expect(session.bindingCount).toBe(0);
  });

  it("releases all bindings for a client session", () => {
    const session = new SandboxTunnelSession(
      {
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "sess_bootstrap",
      },
      2,
    );

    const releasedBinding = session.bindClientStream({
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });
    session.bindClientStream({
      channelKind: "agent",
      clientSessionId: "conn_2",
      clientStreamId: 8,
    });

    expect(
      session.releaseClientSessionBindings({
        clientSessionId: "conn_1",
      }),
    ).toEqual([releasedBinding]);
    expect(session.getBindingByTunnelStreamId(1)).toBeUndefined();
    expect(session.bindingCount).toBe(1);
  });

  it("rejects opening a second active stream for the same client session", () => {
    const session = new SandboxTunnelSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });

    session.bindClientStream({
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });

    expect(() =>
      session.bindClientStream({
        channelKind: "agent",
        clientSessionId: "conn_1",
        clientStreamId: 8,
      }),
    ).toThrow(ClientSessionActiveStreamError);
  });

  it("limits the default session to one active interactive stream", () => {
    const session = new SandboxTunnelSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap",
    });

    session.bindClientStream({
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });

    expect(() =>
      session.bindClientStream({
        channelKind: "agent",
        clientSessionId: "conn_2",
        clientStreamId: 8,
      }),
    ).toThrow(TunnelSessionBindingLimitExceededError);
  });

  it("rejects bindings beyond the configured session limit", () => {
    const session = new SandboxTunnelSession(
      {
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "sess_bootstrap",
      },
      2,
    );

    session.bindClientStream({
      channelKind: "pty",
      clientSessionId: "conn_1",
      clientStreamId: 7,
    });
    session.bindClientStream({
      channelKind: "agent",
      clientSessionId: "conn_2",
      clientStreamId: 8,
    });

    expect(() =>
      session.bindClientStream({
        channelKind: "pty",
        clientSessionId: "conn_3",
        clientStreamId: 9,
      }),
    ).toThrow(TunnelSessionBindingLimitExceededError);
  });
});
