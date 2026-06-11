import { describe, expect, it } from "vitest";

import { SandboxProvider, SandboxTransparentProxyBypassKinds } from "../../types.js";
import { createOpenComputerTransparentProxyConfiguration } from "./transparent-proxy.js";

describe("createOpenComputerTransparentProxyConfiguration", () => {
  it("declares OpenComputer transparent proxy requirements and control-plane exclusions", () => {
    expect(createOpenComputerTransparentProxyConfiguration()).toMatchObject({
      provider: SandboxProvider.OPENCOMPUTER,
      supported: true,
      passthroughBypass: {
        kind: SandboxTransparentProxyBypassKinds.SOCKET_MARK,
      },
    });
    expect(createOpenComputerTransparentProxyConfiguration().exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "app.opencomputer.dev" }),
        expect.objectContaining({ value: "169.254.0.0/16" }),
      ]),
    );
  });
});
