import { z } from "zod";

import { defaultMissingEnabledToFalse } from "../core/discriminated-union.js";

const UrlSchema = z.string().trim().min(1);
const DefaultE2BCloudDomain = "e2b.app";
const DefaultE2BCpuCount = 2;
const DefaultE2BMemoryMb = 4 * 1024;

const ServiceEndpointSchema = z
  .object({
    host: z.string().trim().min(1),
    port: z.number().int().min(1).max(65535),
    internal_url: UrlSchema,
  })
  .strict();

const DashboardPostHogConfigSchema = z
  .preprocess(
    defaultMissingEnabledToFalse,
    z.discriminatedUnion("enabled", [
      z
        .object({
          enabled: z.literal(true),
          project_api_key: z.string().trim().min(1),
          host: UrlSchema,
        })
        .strict(),
      z
        .object({
          enabled: z.literal(false),
          project_api_key: z.string().trim().min(1).optional(),
          host: UrlSchema.optional(),
        })
        .strict(),
    ]),
  )
  .default({ enabled: false });

const TokenConfigSchema = z
  .object({
    secret: z.string().trim().min(1),
    issuer: z.string().trim().min(1),
    audience: z.string().trim().min(1),
  })
  .strict();

const ControlPlaneApiMcpAuthSchema = z
  .object({
    secret: z.string().trim().min(1),
    issuer: z.string().trim().min(1),
    audience: z.string().trim().min(1),
  })
  .strict();

const ObjectStoreSchema = z
  .object({
    bucket_name: z.string().trim().min(1),
    region: z.string().trim().min(1),
    endpoint: UrlSchema.optional(),
    force_path_style: z.boolean().optional(),
    access_key_id: z.string().trim().min(1),
    secret_access_key: z.string().trim().min(1),
  })
  .strict();

const AuthMethodSchema = z.enum(["otp", "google"]);

const ControlPlaneApiWelcomeEmailSchema = z
  .object({
    enabled: z.boolean().default(false),
    call_url: UrlSchema.optional(),
  })
  .strict()
  .default({ enabled: false });

const KvSchema = z
  .object({
    backend: z.enum(["valkey"]),
    url: z.string().trim().min(1),
    key_prefix: z.string().trim().min(1),
  })
  .strict();

const NatsUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      const parsedUrl = new URL(value);
      return parsedUrl.protocol === "nats:" || parsedUrl.protocol === "tls:";
    } catch {
      return false;
    }
  }, "Expected a nats or tls URL.");

const GatewayRelaySchema = z
  .discriminatedUnion("backend", [
    z
      .object({
        backend: z.literal("memory"),
      })
      .strict(),
    z
      .object({
        backend: z.literal("nats"),
        nats: z
          .object({
            url: NatsUrlSchema,
            name_prefix: z.string().trim().min(1),
          })
          .strict(),
      })
      .strict(),
  ])
  .default({ backend: "memory" });

const SandboxDockerProviderConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      socket_path: z.string().trim().min(1),
      network_name: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      socket_path: z.string().trim().min(1).optional(),
      network_name: z.string().trim().min(1).optional(),
    })
    .strict(),
]);

const SandboxE2BProviderConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      api_key: z.string().trim().min(1),
      domain: z.string().trim().min(1).default(DefaultE2BCloudDomain),
      cpu_count: z.number().int().min(1).default(DefaultE2BCpuCount),
      memory_mb: z.number().int().min(1).default(DefaultE2BMemoryMb),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      api_key: z.string().trim().min(1).optional(),
      domain: z.string().trim().min(1).optional(),
      cpu_count: z.number().int().min(1).optional(),
      memory_mb: z.number().int().min(1).optional(),
    })
    .strict(),
]);

const BillingStripeConfigSchema = z
  .preprocess(
    defaultMissingEnabledToFalse,
    z.discriminatedUnion("enabled", [
      z
        .object({
          enabled: z.literal(true),
          secret_key: z.string().trim().min(1),
        })
        .strict(),
      z
        .object({
          enabled: z.literal(false),
          secret_key: z.string().trim().min(1).optional(),
        })
        .strict(),
    ]),
  )
  .default({ enabled: false });

const SandboxTensorlakeProviderConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      api_key: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      api_key: z.string().trim().min(1).optional(),
    })
    .strict(),
]);

const ControlPlaneApiAuthSchema = z
  .object({
    secret: z.string().trim().min(1),
    trusted_origins: z.array(UrlSchema).min(1),
    enabled_methods: z.array(AuthMethodSchema).min(1).optional(),
    allow_signups: z.boolean().default(true),
    welcome_email: ControlPlaneApiWelcomeEmailSchema,
    otp: z
      .object({
        length: z.number().int().min(4).max(12),
        expires_in_seconds: z.number().int().min(30),
        allowed_attempts: z.number().int().min(1).max(10),
      })
      .strict(),
    google: z
      .object({
        client_id: z.string().trim().min(1),
        client_secret: z.string().trim().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.enabled_methods !== undefined && !value.enabled_methods.includes("otp")) {
      ctx.addIssue({
        code: "custom",
        path: ["enabled_methods"],
        message: "The current runtime config requires otp to be enabled.",
      });
    }

    if (value.enabled_methods?.includes("google") === true && value.google === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["google"],
        message: "Google auth config is required when google auth is enabled.",
      });
    }
  });

export const ConfigSchema = z
  .object({
    global: z
      .object({
        env: z.enum(["development", "production"]),
      })
      .strict(),
    telemetry: z.discriminatedUnion("enabled", [
      z
        .object({
          enabled: z.literal(true),
          debug: z.boolean(),
          resource_attributes: z.string().trim().min(1).optional(),
          traces: z.object({ endpoint: UrlSchema }).strict(),
          logs: z.object({ endpoint: UrlSchema }).strict(),
          metrics: z.object({ endpoint: UrlSchema }).strict(),
        })
        .strict(),
      z
        .object({
          enabled: z.literal(false),
          debug: z.boolean(),
          resource_attributes: z.string().trim().min(1).optional(),
          traces: z.object({ endpoint: UrlSchema.optional() }).strict().optional(),
          logs: z.object({ endpoint: UrlSchema.optional() }).strict().optional(),
          metrics: z.object({ endpoint: UrlSchema.optional() }).strict().optional(),
        })
        .strict(),
    ]),
    services: z
      .object({
        dashboard: z
          .object({
            public_url: UrlSchema,
            control_plane_api_origin: UrlSchema,
            posthog: DashboardPostHogConfigSchema,
          })
          .strict(),
        control_plane_api: ServiceEndpointSchema.extend({
          public_url: UrlSchema,
          workflow_database_pool_max: z.number().int().min(1),
          auth: ControlPlaneApiAuthSchema,
          mcp: z
            .object({
              url: UrlSchema,
              trust_forwarded_headers: z.boolean().default(false),
              auth: ControlPlaneApiMcpAuthSchema,
            })
            .strict(),
          integrations: z
            .object({
              active_master_encryption_key_version: z.number().int().min(1),
              master_encryption_keys: z.record(
                z.string().regex(/^[1-9]\d*$/),
                z.string().trim().min(1),
              ),
            })
            .strict(),
        }).strict(),
        data_plane_api: ServiceEndpointSchema.extend({
          workflow_database_pool_max: z.number().int().min(1),
        }).strict(),
        data_plane_gateway: ServiceEndpointSchema.extend({
          sandbox_ws_public_url: UrlSchema,
          sandbox_ws_internal_url: UrlSchema,
          health: z
            .object({
              websocket_ping_interval_ms: z.number().int().positive().optional(),
              websocket_pong_timeout_ms: z.number().int().positive().optional(),
            })
            .strict()
            .optional(),
          port_access: z
            .object({
              authorization_timeout_ms: z.number().int().positive().optional(),
            })
            .strict()
            .optional(),
        }).strict(),
        control_plane_worker: z
          .object({
            workflow_concurrency: z.number().int().min(1),
            workflow_database_pool_max: z.number().int().min(1),
          })
          .strict(),
        data_plane_worker: z
          .object({
            workflow_concurrency: z.number().int().min(1),
            workflow_database_pool_max: z.number().int().min(1),
          })
          .strict(),
      })
      .strict(),
    workflow: z
      .object({
        control_plane: z
          .object({
            namespace_id: z.string().trim().min(1),
          })
          .strict(),
        data_plane: z
          .object({
            namespace_id: z.string().trim().min(1),
          })
          .strict(),
      })
      .strict(),
    postgres: z
      .object({
        control_plane: z
          .object({
            direct_url: z.string().trim().min(1),
            pooled_url: z.string().trim().min(1),
          })
          .strict(),
        data_plane: z
          .object({
            direct_url: z.string().trim().min(1),
            pooled_url: z.string().trim().min(1),
          })
          .strict(),
      })
      .strict(),
    kv: z
      .object({
        control_plane: KvSchema.optional(),
        data_plane: KvSchema,
      })
      .strict(),
    gateway_relay: GatewayRelaySchema,
    object_store: z
      .object({
        assets: ObjectStoreSchema,
      })
      .strict(),
    email: z
      .object({
        smtp: z
          .object({
            from_address: z.string().trim().min(1),
            from_name: z.string().trim().min(1),
            host: z.string().trim().min(1),
            port: z.number().int().min(1).max(65535),
            secure: z.boolean(),
            username: z.string().trim().min(1),
            password: z.string().trim().min(1),
          })
          .strict(),
      })
      .strict(),
    internal_auth: z
      .object({
        method: z.literal("shared_token").optional(),
        shared_token: z
          .object({
            token: z.string().trim().min(1),
          })
          .strict(),
      })
      .strict(),
    billing: z
      .object({
        stripe: BillingStripeConfigSchema,
      })
      .strict()
      .default({ stripe: { enabled: false } }),
    sandbox: z
      .object({
        default_base_image: z.string().trim().min(1),
        publish_base_domain: z.string().trim().min(1),
        tokens: z
          .object({
            connect: TokenConfigSchema,
            bootstrap: TokenConfigSchema,
            egress: TokenConfigSchema,
            pty_transport: TokenConfigSchema,
          })
          .strict(),
        publish: z
          .object({
            access_token: TokenConfigSchema,
            session: z
              .object({
                cookie_signing_secret: z.string().trim().min(1),
              })
              .strict(),
          })
          .strict(),
        docker: SandboxDockerProviderConfigSchema.optional(),
        sandboxd_test_faults_enabled: z.boolean().optional(),
        e2b: SandboxE2BProviderConfigSchema.optional(),
        tensorlake: SandboxTensorlakeProviderConfigSchema.optional(),
      })
      .strict(),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;
