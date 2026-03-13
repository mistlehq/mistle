import { describe, expect, it } from "vitest";

import { TunnelSessionRegistry } from "./tunnel-session-registry.js";

describe("TunnelSessionRegistry", () => {
  it("replaces the bootstrap session for a sandbox instance", () => {
    const registry = new TunnelSessionRegistry();

    const firstAttach = registry.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap_1",
    });
    const secondAttach = registry.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap_2",
    });

    expect(firstAttach.replacedSession).toBeUndefined();
    expect(secondAttach.replacedSession).toBe(firstAttach.session);
    expect(
      registry.getBootstrapSession({
        sandboxInstanceId: "sbi_test",
      }),
    ).toBe(secondAttach.session);
  });

  it("only detaches the currently registered bootstrap session", () => {
    const registry = new TunnelSessionRegistry();

    const { session } = registry.attachBootstrapSession({
      sandboxInstanceId: "sbi_test",
      side: "bootstrap",
      nodeId: "dpg_test",
      sessionId: "sess_bootstrap_1",
    });

    expect(
      registry.detachBootstrapSession({
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "stale_session",
      }),
    ).toBeUndefined();
    expect(
      registry.getBootstrapSession({
        sandboxInstanceId: "sbi_test",
      }),
    ).toBe(session);

    expect(
      registry.detachBootstrapSession({
        sandboxInstanceId: "sbi_test",
        side: "bootstrap",
        nodeId: "dpg_test",
        sessionId: "sess_bootstrap_1",
      }),
    ).toBe(session);
    expect(
      registry.getBootstrapSession({
        sandboxInstanceId: "sbi_test",
      }),
    ).toBeUndefined();
  });
});
