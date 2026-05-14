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

describe("ConfigSchema billing config", () => {
  it("defaults Stripe billing to disabled", () => {
    const parsed = ConfigSchema.shape.billing.parse(undefined);

    expect(parsed).toEqual({
      stripe: {
        enabled: false,
      },
    });
  });

  it("requires a Stripe secret key when Stripe billing is enabled", () => {
    expect(() =>
      ConfigSchema.shape.billing.parse({
        stripe: {
          enabled: true,
        },
      }),
    ).toThrow(/secret_key/u);
  });

  it("keeps Stripe billing disabled when only the secret is provisioned", () => {
    const parsed = ConfigSchema.shape.billing.parse({
      stripe: {
        secret_key: "sk_test_secret",
      },
    });

    expect(parsed).toEqual({
      stripe: {
        enabled: false,
        secret_key: "sk_test_secret",
      },
    });
  });
});
