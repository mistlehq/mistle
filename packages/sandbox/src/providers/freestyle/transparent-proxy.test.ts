import { describe, expect, it } from "vitest";

import { SandboxTransparentPassthroughSocketMark } from "../../transparent-proxy.js";
import {
  SandboxProvider,
  SandboxTransparentProxyBypassKinds,
  SandboxTransparentProxyExclusionKinds,
} from "../../types.js";
import { createFreestyleTransparentProxyConfiguration } from "./transparent-proxy.js";

describe("createFreestyleTransparentProxyConfiguration", () => {
  it("returns Freestyle transparent proxy capabilities with provider control exclusions", () => {
    expect(createFreestyleTransparentProxyConfiguration()).toEqual({
      provider: SandboxProvider.FREESTYLE,
      supported: true,
      passthroughBypass: {
        kind: SandboxTransparentProxyBypassKinds.SOCKET_MARK,
        mark: SandboxTransparentPassthroughSocketMark,
      },
      requiredLinuxCapabilities: ["NET_ADMIN"],
      exclusions: expect.arrayContaining([
        {
          kind: SandboxTransparentProxyExclusionKinds.HOST,
          value: "api.freestyle.sh",
          reason: "Freestyle control-plane API must bypass transparent proxying.",
        },
        {
          kind: SandboxTransparentProxyExclusionKinds.HOST,
          value: "vm-ssh.freestyle.sh",
          reason: "Freestyle VM control channel must bypass transparent proxying.",
        },
        {
          kind: SandboxTransparentProxyExclusionKinds.HOST,
          value: "git.freestyle.sh",
          reason: "Freestyle provider Git/control traffic must bypass transparent proxying.",
        },
        {
          kind: SandboxTransparentProxyExclusionKinds.CIDR,
          value: "169.254.0.0/16",
          reason:
            "Freestyle/link-local metadata and host services must bypass transparent proxying.",
        },
      ]),
      smokeRequirements: [
        "nftables table ip mistle_transparent_egress can be created",
        "output NAT redirect to local listener works",
        "Freestyle control APIs remain reachable after proxy rules are installed",
      ],
    });
  });
});
