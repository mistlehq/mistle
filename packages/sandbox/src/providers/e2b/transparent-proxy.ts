import { createTransparentProxyConfiguration } from "../../transparent-proxy.js";
import {
  SandboxProvider,
  SandboxTransparentProxyExclusionKinds,
  type SandboxTransparentProxyConfiguration,
  type SandboxTransparentProxyExclusion,
} from "../../types.js";

const E2BTransparentProxyExclusions = [
  {
    kind: SandboxTransparentProxyExclusionKinds.CIDR,
    value: "169.254.0.0/16",
    reason: "E2B link-local control and metadata traffic must remain direct",
  },
  {
    kind: SandboxTransparentProxyExclusionKinds.CIDR,
    value: "192.0.2.0/24",
    reason: "E2B envd remotes observed during the Phase 4D spike must remain direct",
  },
  {
    kind: SandboxTransparentProxyExclusionKinds.CIDR,
    value: "10.0.0.0/8",
    reason: "E2B private control endpoints observed during the Phase 4D spike must remain direct",
  },
] satisfies readonly SandboxTransparentProxyExclusion[];

export function createE2BTransparentProxyConfiguration(): SandboxTransparentProxyConfiguration {
  return createTransparentProxyConfiguration({
    provider: SandboxProvider.E2B,
    exclusions: E2BTransparentProxyExclusions,
    smokeRequirements: [
      "nftables must be available in the E2B base image",
      "socket-mark bypass rule must be installed before redirect rules",
      "link-local and provider control-plane exclusions must be installed before catch-all redirect",
      "E2B command execution must pass after transparent rules are installed",
    ],
  });
}
