import { describe, expect, it } from "vitest";

import { ConfigSchema, type Config } from "./schema.js";
import {
  selectControlPlaneApiConfig,
  selectControlPlaneWorkerConfig,
  selectDataPlaneApiConfig,
  selectDataPlaneGatewayConfig,
  selectDataPlaneWorkerConfig,
} from "./selectors.js";

function createRootConfig(input: {
  allowSignups?: boolean;
  billingStripe?: { enabled: false; secret_key?: string } | { enabled: true; secret_key: string };
  enabledMethods?: Array<"otp" | "google">;
  gatewayRelay?: Config["gateway_relay"];
  google?: {
    client_id: string;
    client_secret: string;
  };
  sandbox?: Partial<Config["sandbox"]>;
  welcomeEmail?: Config["services"]["control_plane_api"]["auth"]["welcome_email"];
}): Config {
  return {
    global: {
      env: "production",
    },
    telemetry: {
      enabled: false,
      debug: false,
    },
    services: {
      dashboard: {
        public_url: "https://app.example.com",
        control_plane_api_origin: "https://api.example.com",
        posthog: {
          enabled: false,
        },
      },
      control_plane_api: {
        host: "0.0.0.0",
        port: 8080,
        public_url: "https://api.example.com",
        internal_url: "http://control-plane-api:8080",
        workflow_database_pool_max: 2,
        auth: {
          secret: "auth-secret",
          trusted_origins: ["https://app.example.com"],
          allow_signups: input.allowSignups ?? true,
          welcome_email: input.welcomeEmail ?? {
            enabled: false,
          },
          ...(input.enabledMethods === undefined ? {} : { enabled_methods: input.enabledMethods }),
          otp: {
            length: 6,
            expires_in_seconds: 300,
            allowed_attempts: 3,
          },
          ...(input.google === undefined ? {} : { google: input.google }),
        },
        mcp: {
          url: "https://mcp.example.com/mcp",
          trust_forwarded_headers: true,
          auth: {
            secret: "mcp-auth-secret",
            issuer: "control-plane-api",
            audience: "mistle-mcp",
          },
        },
        integrations: {
          active_master_encryption_key_version: 1,
          master_encryption_keys: {
            "1": "master-key",
          },
        },
      },
      data_plane_api: {
        host: "0.0.0.0",
        port: 8082,
        internal_url: "http://data-plane-api:8082",
        workflow_database_pool_max: 3,
      },
      data_plane_gateway: {
        host: "0.0.0.0",
        port: 8084,
        internal_url: "http://data-plane-gateway:8084",
        sandbox_ws_public_url: "wss://gateway.example.com/tunnel/sandbox",
        sandbox_ws_internal_url: "ws://data-plane-gateway:8084/tunnel/sandbox",
      },
      control_plane_worker: {
        workflow_concurrency: 4,
        workflow_database_pool_max: 6,
      },
      data_plane_worker: {
        workflow_concurrency: 5,
        workflow_database_pool_max: 7,
      },
    },
    workflow: {
      control_plane: {
        namespace_id: "control",
      },
      data_plane: {
        namespace_id: "data",
      },
    },
    postgres: {
      control_plane: {
        direct_url: "postgresql://control-direct/mistle",
        pooled_url: "postgresql://control-pooled/mistle",
      },
      data_plane: {
        direct_url: "postgresql://data-direct/mistle",
        pooled_url: "postgresql://data-pooled/mistle",
      },
    },
    kv: {
      data_plane: {
        backend: "valkey",
        url: "redis://data-valkey:6379",
        key_prefix: "mistle:data",
      },
    },
    gateway_relay: input.gatewayRelay ?? {
      backend: "memory",
    },
    object_store: {
      assets: {
        bucket_name: "assets",
        region: "us-east-1",
        access_key_id: "assets-access",
        secret_access_key: "assets-secret",
      },
    },
    email: {
      smtp: {
        from_address: "no-reply@example.com",
        from_name: "Mistle",
        host: "smtp.example.com",
        port: 587,
        secure: false,
        username: "smtp-user",
        password: "smtp-password",
      },
    },
    internal_auth: {
      shared_token: {
        token: "internal-token",
      },
    },
    billing: {
      stripe: input.billingStripe ?? {
        enabled: false,
      },
    },
    sandbox: {
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
        egress: {
          secret: "egress-secret",
          issuer: "data-plane-gateway",
          audience: "mistle-gateway-egress",
        },
        pty_transport: {
          secret: "pty-secret",
          issuer: "data-plane-gateway",
          audience: "mistle-gateway-pty",
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
      e2b: {
        enabled: true,
        api_key: "e2b-api-key",
        domain: "e2b.example.com",
        cpu_count: 4,
        memory_mb: 8192,
      },
      tensorlake: {
        enabled: true,
        api_key: "tensorlake-api-key",
      },
      ...input.sandbox,
    },
  };
}

describe("selectControlPlaneApiConfig", () => {
  it("omits Google auth when credentials are configured but google is not enabled", () => {
    const config = selectControlPlaneApiConfig(
      createRootConfig({
        enabledMethods: ["otp"],
        google: {
          client_id: "google-client-id",
          client_secret: "google-client-secret",
        },
      }),
    );

    expect(config.auth.google).toBeUndefined();
  });

  it("includes Google auth when google is enabled and configured", () => {
    const config = selectControlPlaneApiConfig(
      createRootConfig({
        enabledMethods: ["otp", "google"],
        google: {
          client_id: "google-client-id",
          client_secret: "google-client-secret",
        },
      }),
    );

    expect(config.auth.google).toEqual({
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
    });
  });

  it("omits Google auth when google is enabled but credentials are not configured", () => {
    const config = selectControlPlaneApiConfig(
      createRootConfig({
        enabledMethods: ["otp", "google"],
      }),
    );

    expect(config.auth.google).toBeUndefined();
  });

  it("selects enabled signup allowance", () => {
    const config = selectControlPlaneApiConfig(createRootConfig({}));

    expect(config.auth.allowSignups).toBe(true);
  });

  it("selects disabled signup allowance", () => {
    const config = selectControlPlaneApiConfig(createRootConfig({ allowSignups: false }));

    expect(config.auth.allowSignups).toBe(false);
  });

  it("selects disabled welcome email config", () => {
    const config = selectControlPlaneApiConfig(createRootConfig({}));

    expect(config.auth.welcomeEmail).toEqual({
      enabled: false,
    });
  });

  it("selects enabled welcome email config", () => {
    const config = selectControlPlaneApiConfig(
      createRootConfig({
        welcomeEmail: {
          enabled: true,
          call_url: "https://cal.example.com/jonathan/mistle",
        },
      }),
    );

    expect(config.auth.welcomeEmail).toEqual({
      enabled: true,
      callUrl: "https://cal.example.com/jonathan/mistle",
    });
  });

  it("selects enabled welcome email config without a call URL", () => {
    const config = selectControlPlaneApiConfig(
      createRootConfig({
        welcomeEmail: {
          enabled: true,
        },
      }),
    );

    expect(config.auth.welcomeEmail).toEqual({
      enabled: true,
    });
  });

  it("keeps welcome email disabled when only the call URL is configured", () => {
    const rootConfig = createRootConfig({});
    const parsedRootConfig = ConfigSchema.parse({
      ...rootConfig,
      services: {
        ...rootConfig.services,
        control_plane_api: {
          ...rootConfig.services.control_plane_api,
          auth: {
            ...rootConfig.services.control_plane_api.auth,
            welcome_email: {
              call_url: "https://cal.example.com/jonathan/mistle",
            },
          },
        },
      },
    });
    const config = selectControlPlaneApiConfig(parsedRootConfig);

    expect(config.auth.welcomeEmail).toEqual({
      enabled: false,
    });
  });

  it("selects MCP config for runtime credential validation", () => {
    const config = selectControlPlaneApiConfig(createRootConfig({}));

    expect(config.mcp.url).toBe("https://mcp.example.com/mcp");
    expect(config.mcp.trustForwardedHeaders).toBe(true);
    expect(config.mcp.auth).toEqual({
      secret: "mcp-auth-secret",
      issuer: "control-plane-api",
      audience: "mistle-mcp",
    });
  });

  it("selects disabled Stripe billing for the control-plane API", () => {
    const config = selectControlPlaneApiConfig(createRootConfig({}));

    expect(config.billing.stripe).toEqual({
      enabled: false,
    });
  });

  it("selects enabled Stripe billing for the control-plane API without exposing the secret", () => {
    const config = selectControlPlaneApiConfig(
      createRootConfig({
        billingStripe: {
          enabled: true,
          secret_key: "sk_test_secret",
        },
      }),
    );

    expect(config.billing.stripe).toEqual({
      enabled: true,
    });
  });

  it("projects Tensorlake as an enabled managed sandbox provider", () => {
    const config = selectControlPlaneApiConfig(createRootConfig({}));

    expect(config.sandbox.tensorlake).toEqual({
      enabled: true,
      apiKey: "tensorlake-api-key",
    });
  });
});

describe("selectControlPlaneWorkerConfig", () => {
  it("selects enabled Stripe billing with the worker secret", () => {
    const config = selectControlPlaneWorkerConfig(
      createRootConfig({
        billingStripe: {
          enabled: true,
          secret_key: "sk_test_secret",
        },
      }),
    );

    expect(config.billing.stripe).toEqual({
      enabled: true,
      secretKey: "sk_test_secret",
    });
  });

  it("selects disabled Stripe billing with a provisioned worker secret", () => {
    const config = selectControlPlaneWorkerConfig(
      createRootConfig({
        billingStripe: {
          enabled: false,
          secret_key: "sk_test_secret",
        },
      }),
    );

    expect(config.billing.stripe).toEqual({
      enabled: false,
      secretKey: "sk_test_secret",
    });
  });
});

describe("selectDataPlaneApiConfig", () => {
  it("projects remote sandbox providers", () => {
    const config = selectDataPlaneApiConfig(createRootConfig({}));

    expect(config.sandbox.e2b).toEqual({
      enabled: true,
      apiKey: "e2b-api-key",
      domain: "e2b.example.com",
    });
    expect(config.sandbox.tensorlake).toEqual({
      enabled: true,
      apiKey: "tensorlake-api-key",
    });
  });
});

describe("selectDataPlaneGatewayConfig", () => {
  it("projects the default memory gateway relay backend", () => {
    const config = selectDataPlaneGatewayConfig(createRootConfig({}));

    expect(config.gatewayRelay).toEqual({
      backend: "memory",
    });
    expect(config.controlPlaneApi.mcp.auth).toEqual({
      secret: "mcp-auth-secret",
      issuer: "control-plane-api",
      audience: "mistle-mcp",
    });
  });

  it("projects NATS gateway relay config", () => {
    const config = selectDataPlaneGatewayConfig(
      createRootConfig({
        gatewayRelay: {
          backend: "nats",
          nats: {
            url: "nats://gateway-relay:4222",
            name_prefix: "mistle-prod",
          },
        },
      }),
    );

    expect(config.gatewayRelay).toEqual({
      backend: "nats",
      nats: {
        url: "nats://gateway-relay:4222",
        namePrefix: "mistle-prod",
      },
    });
  });
});

describe("selectDataPlaneWorkerConfig", () => {
  it("projects remote sandbox providers", () => {
    const config = selectDataPlaneWorkerConfig(createRootConfig({}));

    expect(config.sandbox.e2b).toEqual({
      enabled: true,
      apiKey: "e2b-api-key",
      domain: "e2b.example.com",
      cpuCount: 4,
      memoryMb: 8192,
    });
    expect(config.sandbox.tensorlake).toEqual({
      enabled: true,
      apiKey: "tensorlake-api-key",
    });
  });
});
