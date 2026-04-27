import { type AppConfig, ConfigSchema as RuntimeConfigSchema } from "../schema.js";
import { type Config } from "./schema.js";

function buildArchilMount(
  config: Config,
): AppConfig["apps"]["data_plane_worker"]["sandboxStorage"] {
  const archilConfig = config.sandbox.storage?.archil;

  if (archilConfig === undefined) {
    return {};
  }

  if (archilConfig.mount_object_store === undefined) {
    return {
      archil: {
        apiKey: archilConfig.api_key,
        region: archilConfig.region,
        namePrefix: archilConfig.name_prefix,
      },
    };
  }

  const sandboxObjectStore = config.object_store.sandbox_storage;

  if (sandboxObjectStore === undefined) {
    throw new Error(
      "object_store.sandbox_storage is required when sandbox.storage.archil.mount_object_store is 'sandbox_storage'.",
    );
  }

  if (sandboxObjectStore.endpoint === undefined) {
    throw new Error(
      "object_store.sandbox_storage.endpoint is required when it is mounted into Archil sandbox storage.",
    );
  }

  return {
    archil: {
      apiKey: archilConfig.api_key,
      region: archilConfig.region,
      namePrefix: archilConfig.name_prefix,
      mounts: [
        {
          type: "s3-compatible",
          bucket: sandboxObjectStore.bucket_name,
          endpoint: sandboxObjectStore.endpoint,
          accessKeyId: sandboxObjectStore.access_key_id,
          secretAccessKey: sandboxObjectStore.secret_access_key,
        },
      ],
    },
  };
}

function buildSandboxStorage(
  config: Config,
): AppConfig["apps"]["data_plane_worker"]["sandboxStorage"] {
  const dockerVolumeConfig = config.sandbox.storage?.docker_volume;

  return {
    ...buildArchilMount(config),
    ...(dockerVolumeConfig === undefined
      ? {}
      : {
          dockerVolume: {
            namePrefix: dockerVolumeConfig.name_prefix,
          },
        }),
  };
}

function projectTelemetry(config: Config): AppConfig["global"]["telemetry"] {
  if (config.telemetry.enabled) {
    return {
      enabled: true,
      debug: config.telemetry.debug,
      traces: config.telemetry.traces,
      logs: config.telemetry.logs,
      metrics: config.telemetry.metrics,
      resourceAttributes: config.telemetry.resource_attributes,
    };
  }

  return {
    enabled: false,
    debug: config.telemetry.debug,
    traces: config.telemetry.traces,
    logs: config.telemetry.logs,
    metrics: config.telemetry.metrics,
    resourceAttributes: config.telemetry.resource_attributes,
  };
}

export function projectToRuntimeConfig(config: Config): AppConfig {
  const googleAuth = config.services.control_plane_api.auth.google;
  const dashboardPublicUrl = config.services.dashboard.public_url;
  const controlPlaneApiInternalUrl = config.services.control_plane_api.internal_url;
  const dataPlaneApiInternalUrl = config.services.data_plane_api.internal_url;
  const dataPlaneGatewayInternalUrl = config.services.data_plane_gateway.internal_url;
  const tokenizerProxyEgressUrl = config.services.tokenizer_proxy.egress_url;
  const sandboxStorage =
    config.sandbox.storage === undefined
      ? undefined
      : {
          backend: config.sandbox.storage.backend,
        };

  const runtimeConfig: AppConfig = {
    global: {
      env: config.global.env,
      telemetry: projectTelemetry(config),
      internalAuth: {
        serviceToken: config.internal_auth.shared_token.token,
      },
      sandbox: {
        provider: config.sandbox.provider,
        storage: sandboxStorage,
        defaultBaseImage: config.sandbox.default_base_image,
        gatewayWsUrl: config.services.data_plane_gateway.sandbox_ws_public_url,
        internalGatewayWsUrl: config.services.data_plane_gateway.sandbox_ws_internal_url,
        publish: {
          baseDomain: config.sandbox.publish_base_domain,
          access: {
            tokenSecret: config.sandbox.publish.access_token.secret,
            tokenIssuer: config.sandbox.publish.access_token.issuer,
            tokenAudience: config.sandbox.publish.access_token.audience,
          },
          session: {
            cookieSigningSecret: config.sandbox.publish.session.cookie_signing_secret,
          },
        },
        connect: {
          tokenSecret: config.sandbox.tokens.connect.secret,
          tokenIssuer: config.sandbox.tokens.connect.issuer,
          tokenAudience: config.sandbox.tokens.connect.audience,
        },
        bootstrap: {
          tokenSecret: config.sandbox.tokens.bootstrap.secret,
          tokenIssuer: config.sandbox.tokens.bootstrap.issuer,
          tokenAudience: config.sandbox.tokens.bootstrap.audience,
        },
        egress: {
          tokenSecret: config.sandbox.tokens.egress.secret,
          tokenIssuer: config.sandbox.tokens.egress.issuer,
          tokenAudience: config.sandbox.tokens.egress.audience,
        },
      },
    },
    apps: {
      control_plane_api: {
        server: {
          host: config.services.control_plane_api.host,
          port: config.services.control_plane_api.port,
        },
        database: {
          url: config.postgres.control_plane.pooled_url,
          migrationUrl: config.postgres.control_plane.direct_url,
        },
        objectStore: {
          bucketName: config.object_store.assets.bucket_name,
          region: config.object_store.assets.region,
          endpoint: config.object_store.assets.endpoint,
          forcePathStyle: config.object_store.assets.force_path_style,
          accessKeyId: config.object_store.assets.access_key_id,
          secretAccessKey: config.object_store.assets.secret_access_key,
        },
        auth: {
          baseUrl: config.services.control_plane_api.public_url,
          secret: config.services.control_plane_api.auth.secret,
          trustedOrigins: config.services.control_plane_api.auth.trusted_origins,
          otpLength: config.services.control_plane_api.auth.otp.length,
          otpExpiresInSeconds: config.services.control_plane_api.auth.otp.expires_in_seconds,
          otpAllowedAttempts: config.services.control_plane_api.auth.otp.allowed_attempts,
          ...(googleAuth === undefined
            ? {}
            : {
                google: {
                  clientId: googleAuth.client_id,
                  clientSecret: googleAuth.client_secret,
                },
              }),
        },
        dashboard: {
          baseUrl: dashboardPublicUrl,
        },
        workflow: {
          databaseUrl: config.postgres.control_plane.pooled_url,
          migrationUrl: config.postgres.control_plane.direct_url,
          namespaceId: config.workflow.control_plane.namespace_id,
        },
        dataPlaneApi: {
          baseUrl: dataPlaneApiInternalUrl,
        },
        integrations: {
          activeMasterEncryptionKeyVersion:
            config.services.control_plane_api.integrations.active_master_encryption_key_version,
          masterEncryptionKeys:
            config.services.control_plane_api.integrations.master_encryption_keys,
        },
      },
      control_plane_worker: {
        workflow: {
          databaseUrl: config.postgres.control_plane.pooled_url,
          namespaceId: config.workflow.control_plane.namespace_id,
          runMigrations: false,
          concurrency: config.services.control_plane_worker.workflow_concurrency,
        },
        email: {
          fromAddress: config.email.smtp.from_address,
          fromName: config.email.smtp.from_name,
          smtpHost: config.email.smtp.host,
          smtpPort: config.email.smtp.port,
          smtpSecure: config.email.smtp.secure,
          smtpUsername: config.email.smtp.username,
          smtpPassword: config.email.smtp.password,
        },
        dataPlaneApi: {
          baseUrl: dataPlaneApiInternalUrl,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneApiInternalUrl,
        },
      },
      data_plane_api: {
        server: {
          host: config.services.data_plane_api.host,
          port: config.services.data_plane_api.port,
        },
        database: {
          url: config.postgres.data_plane.pooled_url,
          migrationUrl: config.postgres.data_plane.direct_url,
        },
        workflow: {
          databaseUrl: config.postgres.data_plane.pooled_url,
          migrationUrl: config.postgres.data_plane.direct_url,
          namespaceId: config.workflow.data_plane.namespace_id,
        },
        runtimeState: {
          gatewayBaseUrl: dataPlaneGatewayInternalUrl,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneApiInternalUrl,
        },
        sandbox: {
          docker: config.sandbox.docker
            ? {
                socketPath: config.sandbox.docker.socket_path,
              }
            : undefined,
          ...(config.sandbox.e2b === undefined
            ? {}
            : {
                e2b: {
                  apiKey: config.sandbox.e2b.api_key,
                  domain: config.sandbox.e2b.domain,
                },
              }),
        },
      },
      data_plane_gateway: {
        server: {
          host: config.services.data_plane_gateway.host,
          port: config.services.data_plane_gateway.port,
        },
        database: {
          url: config.postgres.data_plane.pooled_url,
        },
        runtimeState: {
          backend: config.kv.data_plane.backend,
          valkey: {
            url: config.kv.data_plane.url,
            keyPrefix: config.kv.data_plane.key_prefix,
          },
        },
        dataPlaneApi: {
          baseUrl: dataPlaneApiInternalUrl,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneApiInternalUrl,
        },
      },
      data_plane_worker: {
        database: {
          url: config.postgres.data_plane.pooled_url,
        },
        workflow: {
          databaseUrl: config.postgres.data_plane.pooled_url,
          namespaceId: config.workflow.data_plane.namespace_id,
          runMigrations: false,
          concurrency: config.services.data_plane_worker.workflow_concurrency,
        },
        runtimeState: {
          gatewayBaseUrl: dataPlaneGatewayInternalUrl,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneApiInternalUrl,
        },
        sandbox: {
          tokenizerProxyEgressBaseUrl: tokenizerProxyEgressUrl,
          docker:
            config.sandbox.docker === undefined
              ? undefined
              : {
                  socketPath: config.sandbox.docker.socket_path,
                  networkName: config.sandbox.docker.network_name,
                },
          e2b:
            config.sandbox.e2b === undefined
              ? undefined
              : {
                  apiKey: config.sandbox.e2b.api_key,
                  domain: config.sandbox.e2b.domain,
                  cpuCount: config.sandbox.e2b.cpu_count,
                  memoryMb: config.sandbox.e2b.memory_mb,
                },
        },
        sandboxStorage: buildSandboxStorage(config),
      },
      tokenizer_proxy: {
        server: {
          host: config.services.tokenizer_proxy.host,
          port: config.services.tokenizer_proxy.port,
        },
        controlPlaneApi: {
          baseUrl: controlPlaneApiInternalUrl,
          publicBaseUrl: config.services.control_plane_api.public_url,
        },
      },
    },
  };

  return RuntimeConfigSchema.parse(runtimeConfig);
}
