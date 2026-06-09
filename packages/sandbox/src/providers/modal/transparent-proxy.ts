import { createTransparentProxyConfiguration } from "../../transparent-proxy.js";
import {
  SandboxProvider,
  SandboxTransparentProxyExclusionKinds,
  type SandboxTransparentProxyConfiguration,
} from "../../types.js";

const ModalTransparentProxyExclusions = [
  {
    kind: SandboxTransparentProxyExclusionKinds.CIDR,
    value: "169.254.0.0/16",
    reason: "link-local metadata and platform services must not be transparently proxied",
  },
] as const;

export function createModalTransparentProxyConfiguration(): SandboxTransparentProxyConfiguration {
  return createTransparentProxyConfiguration({
    provider: SandboxProvider.MODAL,
    exclusions: ModalTransparentProxyExclusions,
    smokeRequirements: [
      "Modal VM sandbox runtime must be enabled",
      "nftables must be available in the Modal base image",
      "socket-mark bypass rule must be installed before redirect rules",
      "Modal command execution must pass after transparent rules are installed",
    ],
  });
}
