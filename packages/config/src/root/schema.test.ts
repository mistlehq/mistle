import { describe, expect, it } from "vitest";

import { ConfigSchema } from "./schema.js";

describe("ConfigSchema sandbox provider config", () => {
  it("accepts disabled Docker provider settings without enabling managed Docker", () => {
    const parsed = ConfigSchema.shape.sandbox.parse({
      default_base_image: "registry.example.com/sandbox:latest",
      publish_base_domain: "mistle.example",
      tokens: {
        connect: {
          secret: "connect-secret",
          issuer: "control-plane-api",
          audience: "data-plane-gateway",
        },
        bootstrap: {
          secret: "bootstrap-secret",
          issuer: "data-plane-worker",
          audience: "data-plane-gateway",
        },
      },
      publish: {
        access_token: {
          secret: "publish-access-secret",
          issuer: "control-plane-api",
          audience: "data-plane-gateway",
        },
        session: {
          cookie_signing_secret: "publish-session-secret",
        },
      },
      docker: {
        enabled: false,
        socket_path: "/var/run/docker.sock",
        network_name: "mistle-sandbox-dev",
      },
    });

    expect(parsed.docker).toEqual({
      enabled: false,
      socket_path: "/var/run/docker.sock",
      network_name: "mistle-sandbox-dev",
    });
  });
});
