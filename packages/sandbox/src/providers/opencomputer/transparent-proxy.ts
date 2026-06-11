import { createTransparentProxyConfiguration } from "../../transparent-proxy.js";
import {
  SandboxProvider,
  SandboxTransparentProxyExclusionKinds,
  type SandboxTransparentProxyConfiguration,
} from "../../types.js";

export function createOpenComputerTransparentProxyConfiguration(): SandboxTransparentProxyConfiguration {
  return createTransparentProxyConfiguration({
    provider: SandboxProvider.OPENCOMPUTER,
    exclusions: [
      {
        kind: SandboxTransparentProxyExclusionKinds.HOST,
        value: "app.opencomputer.dev",
        reason: "OpenComputer control-plane API must bypass transparent proxying.",
      },
      {
        kind: SandboxTransparentProxyExclusionKinds.CIDR,
        value: "169.254.0.0/16",
        reason:
          "OpenComputer/link-local metadata and platform services must bypass transparent proxying.",
      },
    ],
    smokeRequirements: [
      "nftables must be installed in the OpenComputer base image",
      "socket-mark bypass rule must be installed before redirect rules",
      "OpenComputer control APIs remain reachable after proxy rules are installed",
      "real Mistle gateway HTTPS interception must pass before catalog exposure",
    ],
  });
}
