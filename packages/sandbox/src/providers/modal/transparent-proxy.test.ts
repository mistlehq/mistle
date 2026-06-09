import { describe, expect, it } from "vitest";

import { SandboxTransparentPassthroughSocketMark } from "../../transparent-proxy.js";
import {
  SandboxProvider,
  SandboxTransparentProxyBypassKinds,
  SandboxTransparentProxyExclusionKinds,
} from "../../types.js";
import { createModalTransparentProxyConfiguration } from "./transparent-proxy.js";

describe("createModalTransparentProxyConfiguration", () => {
  it("returns Modal VM transparent proxy requirements and link-local exclusions", () => {
    expect(createModalTransparentProxyConfiguration()).toEqual({
      provider: SandboxProvider.MODAL,
      supported: true,
      passthroughBypass: {
        kind: SandboxTransparentProxyBypassKinds.SOCKET_MARK,
        mark: SandboxTransparentPassthroughSocketMark,
      },
      requiredLinuxCapabilities: ["NET_ADMIN"],
      exclusions: expect.arrayContaining([
        {
          kind: SandboxTransparentProxyExclusionKinds.CIDR,
          value: "169.254.0.0/16",
          reason: "link-local metadata and platform services must not be transparently proxied",
        },
      ]),
      smokeRequirements: [
        "Modal VM sandbox runtime must be enabled",
        "nftables must be available in the Modal base image",
        "socket-mark bypass rule must be installed before redirect rules",
        "Modal command execution must pass after transparent rules are installed",
      ],
    });
  });
});
