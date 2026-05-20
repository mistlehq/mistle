import { createTransparentProxyConfiguration } from "../../transparent-proxy.js";
import {
  SandboxProvider,
  SandboxTransparentProxyExclusionKinds,
  type SandboxTransparentProxyConfiguration,
} from "../../types.js";

const TensorlakeTransparentProxyExclusions = [
  {
    kind: SandboxTransparentProxyExclusionKinds.CIDR,
    value: "169.254.0.0/16",
    reason: "link-local metadata and platform services must not be transparently proxied",
  },
] as const;

export function createTensorlakeTransparentProxyConfiguration(): SandboxTransparentProxyConfiguration {
  return createTransparentProxyConfiguration({
    provider: SandboxProvider.TENSORLAKE,
    exclusions: TensorlakeTransparentProxyExclusions,
    smokeRequirements: [
      "nftables must be available in the Tensorlake base image",
      "socket-mark bypass rule must be installed before redirect rules",
    ],
  });
}
