import {
  SandboxTransparentProxyBypassKinds,
  SandboxTransparentProxyExclusionKinds,
  type SandboxRuntimeProvider,
  type SandboxTransparentProxyConfiguration,
  type SandboxTransparentProxyExclusion,
} from "./types.js";

export const SandboxTransparentPassthroughSocketMark = 38_514;

const GenericTransparentProxyCidrExclusions = [
  {
    kind: SandboxTransparentProxyExclusionKinds.CIDR,
    value: "127.0.0.0/8",
    reason: "loopback traffic must remain local to the sandbox",
  },
  {
    kind: SandboxTransparentProxyExclusionKinds.CIDR,
    value: "::1/128",
    reason: "IPv6 loopback traffic must remain local to the sandbox",
  },
  {
    kind: SandboxTransparentProxyExclusionKinds.CIDR,
    value: "224.0.0.0/4",
    reason: "multicast traffic is outside transparent egress scope",
  },
  {
    kind: SandboxTransparentProxyExclusionKinds.CIDR,
    value: "255.255.255.255/32",
    reason: "broadcast traffic is outside transparent egress scope",
  },
] satisfies readonly SandboxTransparentProxyExclusion[];

export function createRuntimeDestinationTransparentProxyExclusions(input: {
  dnsServerIps: readonly string[];
  gatewayTunnelUrl: string;
  tokenizerProxyEgressUrl?: string;
}): readonly SandboxTransparentProxyExclusion[] {
  return [
    ...input.dnsServerIps.map(createDnsServerExclusion),
    createRuntimeUrlHostExclusion({
      reason: "gateway tunnel traffic must not be redirected into sandboxd",
      url: input.gatewayTunnelUrl,
    }),
    ...(input.tokenizerProxyEgressUrl === undefined
      ? []
      : [
          createRuntimeUrlHostExclusion({
            reason:
              "legacy tokenizer-proxy traffic must remain direct while grant-backed egress exists",
            url: input.tokenizerProxyEgressUrl,
          }),
        ]),
  ];
}

export function createTransparentProxyConfiguration(input: {
  provider: SandboxRuntimeProvider;
  exclusions: readonly SandboxTransparentProxyExclusion[];
  smokeRequirements: readonly string[];
}): SandboxTransparentProxyConfiguration {
  return {
    provider: input.provider,
    supported: true,
    passthroughBypass: {
      kind: SandboxTransparentProxyBypassKinds.SOCKET_MARK,
      mark: SandboxTransparentPassthroughSocketMark,
    },
    requiredLinuxCapabilities: ["NET_ADMIN"],
    exclusions: [...GenericTransparentProxyCidrExclusions, ...input.exclusions],
    smokeRequirements: input.smokeRequirements,
  };
}

function createDnsServerExclusion(ipAddress: string): SandboxTransparentProxyExclusion {
  return {
    kind: SandboxTransparentProxyExclusionKinds.CIDR,
    value: `${ipAddress}/32`,
    reason: "DNS server traffic must remain direct until DNS interception has its own design",
  };
}

function createRuntimeUrlHostExclusion(input: {
  reason: string;
  url: string;
}): SandboxTransparentProxyExclusion {
  const url = new URL(input.url);
  return {
    kind: SandboxTransparentProxyExclusionKinds.HOST,
    value: url.hostname,
    reason: input.reason,
  };
}
