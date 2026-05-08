import { createTransparentProxyConfiguration } from "../../transparent-proxy.js";
import {
  SandboxProvider,
  SandboxTransparentProxyExclusionKinds,
  type SandboxTransparentProxyConfiguration,
  type SandboxTransparentProxyExclusion,
} from "../../types.js";

const DockerTransparentProxyExclusions = [
  {
    kind: SandboxTransparentProxyExclusionKinds.HOST,
    value: "host.docker.internal",
    reason: "Docker host gateway traffic must not be redirected away from the host bridge",
  },
] satisfies readonly SandboxTransparentProxyExclusion[];

export function createDockerTransparentProxyConfiguration(): SandboxTransparentProxyConfiguration {
  return createTransparentProxyConfiguration({
    provider: SandboxProvider.DOCKER,
    exclusions: DockerTransparentProxyExclusions,
    smokeRequirements: [
      "container must run with NET_ADMIN for transparent egress packet rules",
      "nftables must be available in the sandbox runtime",
      "socket-mark bypass rule must be installed before redirect rules",
    ],
  });
}
