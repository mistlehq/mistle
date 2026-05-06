import { describe, expect, it } from "vitest";

import { SandboxTransparentPassthroughSocketMark } from "../../transparent-proxy.js";
import {
  SandboxProvider,
  SandboxTransparentProxyBypassKinds,
  SandboxTransparentProxyExclusionKinds,
} from "../../types.js";
import { createE2BTransparentProxyConfiguration } from "./transparent-proxy.js";

describe("createE2BTransparentProxyConfiguration", () => {
  it("returns E2B transparent proxy capabilities with control-plane CIDR exclusions", () => {
    const configuration = createE2BTransparentProxyConfiguration();

    expect(configuration).toMatchObject({
      provider: SandboxProvider.E2B,
      supported: true,
      passthroughBypass: {
        kind: SandboxTransparentProxyBypassKinds.SOCKET_MARK,
        mark: SandboxTransparentPassthroughSocketMark,
      },
      requiredLinuxCapabilities: ["NET_ADMIN"],
    });
    expect(configuration.exclusions).toContainEqual({
      kind: SandboxTransparentProxyExclusionKinds.CIDR,
      value: "169.254.0.0/16",
      reason: "E2B link-local control and metadata traffic must remain direct",
    });
    expect(configuration.exclusions).toContainEqual({
      kind: SandboxTransparentProxyExclusionKinds.CIDR,
      value: "192.0.2.0/24",
      reason: "E2B envd remotes observed during the Phase 4D spike must remain direct",
    });
    expect(configuration.exclusions).toContainEqual({
      kind: SandboxTransparentProxyExclusionKinds.CIDR,
      value: "10.0.0.0/8",
      reason: "E2B private control endpoints observed during the Phase 4D spike must remain direct",
    });
  });
});
