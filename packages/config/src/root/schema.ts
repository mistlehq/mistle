import { z } from "zod";

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

const TokenConfigSchema = z
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

const SandboxObjectStoreSchema = ObjectStoreSchema.extend({
  region: z.string().trim().min(1).optional(),
}).strict();

const AuthMethodSchema = z.enum(["otp", "google"]);

const KvSchema = z
  .object({
    backend: z.enum(["valkey"]),
    url: z.string().trim().min(1),
    key_prefix: z.string().trim().min(1),
  })
  .strict();

const SandboxStorageArchilSchema = z
  .object({
    api_key: z.string().trim().min(1),
    region: z.string().trim().min(1),
    name_prefix: z.string().trim().min(1).optional(),
    mount_object_store: z.enum(["sandbox_storage"]).optional(),
  })
  .strict();

const SandboxStorageDockerVolumeSchema = z
  .object({
    name_prefix: z.string().trim().min(1).optional(),
  })
  .strict();

const ControlPlaneApiAuthSchema = z
  .object({
    secret: z.string().trim().min(1),
    trusted_origins: z.array(UrlSchema).min(1),
    enabled_methods: z.array(AuthMethodSchema).min(1).optional(),
    allow_signups: z.boolean().default(true),
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
          })
          .strict(),
        control_plane_api: ServiceEndpointSchema.extend({
          public_url: UrlSchema,
          auth: ControlPlaneApiAuthSchema,
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
        data_plane_api: ServiceEndpointSchema,
        data_plane_gateway: ServiceEndpointSchema.extend({
          sandbox_ws_public_url: UrlSchema,
          sandbox_ws_internal_url: UrlSchema,
        }).strict(),
        control_plane_worker: z
          .object({
            workflow_concurrency: z.number().int().min(1),
          })
          .strict(),
        data_plane_worker: z
          .object({
            workflow_concurrency: z.number().int().min(1),
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
    object_store: z
      .object({
        assets: ObjectStoreSchema,
        sandbox_storage: SandboxObjectStoreSchema.optional(),
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
    sandbox: z
      .object({
        provider: z.enum(["docker", "e2b"]),
        default_base_image: z.string().trim().min(1),
        publish_base_domain: z.string().trim().min(1),
        storage: z
          .object({
            backend: z.enum(["archil", "docker_volume"]),
            archil: SandboxStorageArchilSchema.optional(),
            docker_volume: SandboxStorageDockerVolumeSchema.optional(),
          })
          .strict()
          .superRefine((value, ctx) => {
            if (value.backend === "archil" && value.archil === undefined) {
              ctx.addIssue({
                code: "custom",
                path: ["archil"],
                message:
                  "sandbox.storage.archil is required when sandbox.storage.backend is 'archil'.",
              });
            }

            if (value.backend === "docker_volume" && value.docker_volume === undefined) {
              ctx.addIssue({
                code: "custom",
                path: ["docker_volume"],
                message:
                  "sandbox.storage.docker_volume is required when sandbox.storage.backend is 'docker_volume'.",
              });
            }
          })
          .optional(),
        tokens: z
          .object({
            connect: TokenConfigSchema,
            bootstrap: TokenConfigSchema,
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
        docker: z
          .object({
            socket_path: z.string().trim().min(1),
            network_name: z.string().trim().min(1).optional(),
          })
          .strict()
          .optional(),
        sandboxd_test_faults_enabled: z.boolean().optional(),
        e2b: z
          .object({
            api_key: z.string().trim().min(1),
            domain: z.string().trim().min(1).default(DefaultE2BCloudDomain),
            cpu_count: z.number().int().min(1).default(DefaultE2BCpuCount),
            memory_mb: z.number().int().min(1).default(DefaultE2BMemoryMb),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;
