import { describe, expect, it } from "vitest";

import {
  createRuntimeDestinationTransparentProxyExclusions,
  createTransparentProxyConfiguration,
  SandboxTransparentPassthroughSocketMark,
} from "./transparent-proxy.js";
import {
  SandboxProvider,
  SandboxTransparentProxyBypassKinds,
  SandboxTransparentProxyExclusionKinds,
} from "./types.js";

describe("createTransparentProxyConfiguration", () => {
  it("adds shared socket-mark bypass, packet-rule installation requirements, and generic exclusions", () => {
    const configuration = createTransparentProxyConfiguration({
      provider: SandboxProvider.DOCKER,
      exclusions: [
        {
          kind: SandboxTransparentProxyExclusionKinds.HOST,
          value: "provider.example.com",
          reason: "provider-specific control traffic must remain direct",
        },
      ],
      smokeRequirements: ["provider-specific smoke"],
    });

    expect(configuration).toMatchObject({
      provider: SandboxProvider.DOCKER,
      supported: true,
      passthroughBypass: {
        kind: SandboxTransparentProxyBypassKinds.SOCKET_MARK,
        mark: SandboxTransparentPassthroughSocketMark,
      },
      requiredLinuxCapabilities: ["NET_ADMIN"],
      smokeRequirements: ["provider-specific smoke"],
    });
    expect(configuration.exclusions).toContainEqual({
      kind: SandboxTransparentProxyExclusionKinds.CIDR,
      value: "127.0.0.0/8",
      reason: "loopback traffic must remain local to the sandbox",
    });
    expect(configuration.exclusions).toContainEqual({
      kind: SandboxTransparentProxyExclusionKinds.CIDR,
      value: "::1/128",
      reason: "IPv6 loopback traffic must remain local to the sandbox",
    });
    expect(configuration.exclusions).toContainEqual({
      kind: SandboxTransparentProxyExclusionKinds.HOST,
      value: "provider.example.com",
      reason: "provider-specific control traffic must remain direct",
    });
  });
});

describe("createRuntimeDestinationTransparentProxyExclusions", () => {
  it("derives host exclusions from gateway and legacy tokenizer-proxy runtime URLs", () => {
    expect(
      createRuntimeDestinationTransparentProxyExclusions({
        dnsServerIps: ["8.8.8.8", "1.1.1.1"],
        gatewayTunnelUrl: "wss://gateway.mistlestag.ing/tunnel/sandbox",
        tokenizerProxyEgressUrl: "https://proxy.mistlestag.ing/tokenizer-proxy/egress",
      }),
    ).toEqual([
      {
        kind: SandboxTransparentProxyExclusionKinds.CIDR,
        value: "8.8.8.8/32",
        reason: "DNS server traffic must remain direct until DNS interception has its own design",
      },
      {
        kind: SandboxTransparentProxyExclusionKinds.CIDR,
        value: "1.1.1.1/32",
        reason: "DNS server traffic must remain direct until DNS interception has its own design",
      },
      {
        kind: SandboxTransparentProxyExclusionKinds.HOST,
        value: "gateway.mistlestag.ing",
        reason: "gateway tunnel traffic must not be redirected into sandboxd",
      },
      {
        kind: SandboxTransparentProxyExclusionKinds.HOST,
        value: "proxy.mistlestag.ing",
        reason:
          "legacy tokenizer-proxy traffic must remain direct while grant-backed egress exists",
      },
    ]);
  });

  it("omits the tokenizer-proxy exclusion when the legacy path is not configured", () => {
    expect(
      createRuntimeDestinationTransparentProxyExclusions({
        dnsServerIps: [],
        gatewayTunnelUrl: "ws://localhost:5202/tunnel/sandbox",
      }),
    ).toEqual([
      {
        kind: SandboxTransparentProxyExclusionKinds.HOST,
        value: "localhost",
        reason: "gateway tunnel traffic must not be redirected into sandboxd",
      },
    ]);
  });
});
