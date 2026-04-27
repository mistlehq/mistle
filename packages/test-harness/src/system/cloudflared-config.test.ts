import { describe, expect, it } from "vitest";

import {
  buildCloudflaredTunnelConfig,
  parseCloudflaredTunnelCredentialsJson,
} from "./cloudflared-config.js";

describe("parseCloudflaredTunnelCredentialsJson", () => {
  it("parses valid credentials JSON and requires a matching tunnel id", () => {
    expect(
      parseCloudflaredTunnelCredentialsJson({
        tunnelId: "4f782921-0689-45e4-84d9-d8e6398cfef6",
        credentialsJson: JSON.stringify({
          AccountTag: "account-tag",
          TunnelSecret: "secret",
          TunnelID: "4f782921-0689-45e4-84d9-d8e6398cfef6",
        }),
      }),
    ).toEqual({
      AccountTag: "account-tag",
      TunnelSecret: "secret",
      TunnelID: "4f782921-0689-45e4-84d9-d8e6398cfef6",
    });
  });

  it("rejects invalid JSON", () => {
    expect(() =>
      parseCloudflaredTunnelCredentialsJson({
        tunnelId: "4f782921-0689-45e4-84d9-d8e6398cfef6",
        credentialsJson: "{",
      }),
    ).toThrow("Cloudflare tunnel credentials JSON must contain valid JSON.");
  });

  it("rejects credentials that do not match the configured tunnel id", () => {
    expect(() =>
      parseCloudflaredTunnelCredentialsJson({
        tunnelId: "4f782921-0689-45e4-84d9-d8e6398cfef6",
        credentialsJson: JSON.stringify({
          AccountTag: "account-tag",
          TunnelSecret: "secret",
          TunnelID: "95465774-1901-4f6f-8aa8-f6506f39c9f6",
        }),
      }),
    ).toThrow(
      "Cloudflare tunnel credentials TunnelID '95465774-1901-4f6f-8aa8-f6506f39c9f6' does not match configured tunnel id '4f782921-0689-45e4-84d9-d8e6398cfef6'.",
    );
  });
});

describe("buildCloudflaredTunnelConfig", () => {
  it("builds a local credentials-driven tunnel config", () => {
    expect(
      buildCloudflaredTunnelConfig({
        tunnelId: "4f782921-0689-45e4-84d9-d8e6398cfef6",
        credentialsFilePath: "/etc/cloudflared/credentials.json",
        ingressRules: [
          {
            publicHostname: "system-control.example.com",
            serviceUrl: "http://host.docker.internal:5100",
          },
          {
            publicHostname: "gateway.example.com",
            serviceUrl: "http://host.docker.internal:5202",
          },
        ],
      }),
    ).toBe(`tunnel: 4f782921-0689-45e4-84d9-d8e6398cfef6
credentials-file: /etc/cloudflared/credentials.json
ingress:
  - hostname: system-control.example.com
    service: http://host.docker.internal:5100
  - hostname: gateway.example.com
    service: http://host.docker.internal:5202
  - service: http_status:404
`);
  });

  it("rejects configs without ingress rules", () => {
    expect(() =>
      buildCloudflaredTunnelConfig({
        tunnelId: "4f782921-0689-45e4-84d9-d8e6398cfef6",
        credentialsFilePath: "/etc/cloudflared/credentials.json",
        ingressRules: [],
      }),
    ).toThrow("Cloudflare tunnel config requires at least one ingress rule.");
  });
});
