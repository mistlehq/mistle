import { describe, expect, it } from "vitest";

import type { Config } from "./schema.js";
import { selectControlPlaneApiConfig } from "./selectors.js";

function createRootConfig(input: {
  enabledMethods?: Array<"otp" | "google">;
  google?: {
    client_id: string;
    client_secret: string;
  };
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
      },
      control_plane_api: {
        host: "0.0.0.0",
        port: 8080,
        public_url: "https://api.example.com",
        internal_url: "http://control-plane-api:8080",
        auth: {
          secret: "auth-secret",
          trusted_origins: ["https://app.example.com"],
          ...(input.enabledMethods === undefined ? {} : { enabled_methods: input.enabledMethods }),
          otp: {
            length: 6,
            expires_in_seconds: 300,
            allowed_attempts: 3,
          },
          ...(input.google === undefined ? {} : { google: input.google }),
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
      },
      data_plane_gateway: {
        host: "0.0.0.0",
        port: 8084,
        internal_url: "http://data-plane-gateway:8084",
        sandbox_ws_public_url: "wss://gateway.example.com/tunnel/sandbox",
        sandbox_ws_internal_url: "ws://data-plane-gateway:8084/tunnel/sandbox",
      },
      tokenizer_proxy: {
        host: "0.0.0.0",
        port: 8085,
        internal_url: "http://tokenizer-proxy:8085",
        public_url: "https://api.example.com",
        egress_url: "https://api.example.com/tokenizer-proxy/egress",
      },
      control_plane_worker: {
        workflow_concurrency: 4,
      },
      data_plane_worker: {
        workflow_concurrency: 5,
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
    sandbox: {
      provider: "e2b",
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
          issuer: "data-plane-worker",
          audience: "tokenizer-proxy",
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
        api_key: "e2b-api-key",
        domain: "e2b.example.com",
        cpu_count: 4,
        memory_mb: 8192,
      },
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
});
