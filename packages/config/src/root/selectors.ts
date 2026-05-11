import type {
  ControlPlaneApiConfig,
  ControlPlaneApiMaintenanceConfig,
} from "../apps/control-plane-api/schema.js";
import type { ControlPlaneWorkerConfig } from "../apps/control-plane-worker/schema.js";
import type { DataPlaneApiConfig } from "../apps/data-plane-api/schema.js";
import type { DataPlaneGatewayConfig } from "../apps/data-plane-gateway/schema.js";
import type {
  DataPlaneWorkerConfig,
  DataPlaneWorkerSandboxStorageConfig,
} from "../apps/data-plane-worker/schema.js";
import type { GlobalConfig, GlobalTelemetryConfig } from "../global/schema.js";
import { type Config } from "./schema.js";

function buildArchilMount(config: Config): DataPlaneWorkerSandboxStorageConfig {
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

function buildSandboxStorage(config: Config): DataPlaneWorkerSandboxStorageConfig | undefined {
  const dockerVolumeConfig = config.sandbox.storage?.docker_volume;
  const sandboxStorage = {
    ...buildArchilMount(config),
    ...(dockerVolumeConfig === undefined
      ? {}
      : {
          dockerVolume: {
            namePrefix: dockerVolumeConfig.name_prefix,
          },
        }),
  };

  return sandboxStorage.archil === undefined && sandboxStorage.dockerVolume === undefined
    ? undefined
    : sandboxStorage;
}

function projectTelemetry(config: Config): GlobalTelemetryConfig {
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

export function selectGlobalConfig(config: Config): GlobalConfig {
  const sandboxStorage =
    config.sandbox.storage === undefined
      ? undefined
      : {
          backend: config.sandbox.storage.backend,
        };

  return {
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
    },
  };
}

export function selectControlPlaneApiConfig(config: Config): ControlPlaneApiConfig {
  const googleAuth = config.services.control_plane_api.auth.google;
  const isGoogleAuthEnabled =
    config.services.control_plane_api.auth.enabled_methods?.includes("google") === true;

  return {
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
      allowSignups: config.services.control_plane_api.auth.allow_signups,
      otpLength: config.services.control_plane_api.auth.otp.length,
      otpExpiresInSeconds: config.services.control_plane_api.auth.otp.expires_in_seconds,
      otpAllowedAttempts: config.services.control_plane_api.auth.otp.allowed_attempts,
      ...(googleAuth === undefined || !isGoogleAuthEnabled
        ? {}
        : {
            google: {
              clientId: googleAuth.client_id,
              clientSecret: googleAuth.client_secret,
            },
          }),
    },
    dashboard: {
      baseUrl: config.services.dashboard.public_url,
    },
    workflow: {
      databaseUrl: config.postgres.control_plane.direct_url,
      migrationUrl: config.postgres.control_plane.direct_url,
      namespaceId: config.workflow.control_plane.namespace_id,
    },
    dataPlaneApi: {
      baseUrl: config.services.data_plane_api.internal_url,
    },
    internalAuth: {
      serviceToken: config.internal_auth.shared_token.token,
    },
    connectionToken: {
      secret: config.sandbox.tokens.connect.secret,
      issuer: config.sandbox.tokens.connect.issuer,
      audience: config.sandbox.tokens.connect.audience,
    },
    portAccess: {
      baseDomain: config.sandbox.publish_base_domain,
      gatewayWsUrl: config.services.data_plane_gateway.sandbox_ws_public_url,
      access: {
        tokenSecret: config.sandbox.publish.access_token.secret,
        tokenIssuer: config.sandbox.publish.access_token.issuer,
        tokenAudience: config.sandbox.publish.access_token.audience,
      },
    },
    sandbox: {
      provider: config.sandbox.provider,
      defaultBaseImage: config.sandbox.default_base_image,
      gatewayWsUrl: config.services.data_plane_gateway.sandbox_ws_public_url,
      bootstrap: {
        tokenSecret: config.sandbox.tokens.bootstrap.secret,
        tokenIssuer: config.sandbox.tokens.bootstrap.issuer,
        tokenAudience: config.sandbox.tokens.bootstrap.audience,
      },
      storageBackend: config.sandbox.storage?.backend,
      ...(config.sandbox.e2b === undefined
        ? {}
        : {
            e2b: {
              apiKey: config.sandbox.e2b.api_key,
              domain: config.sandbox.e2b.domain,
            },
          }),
    },
    integrations: {
      activeMasterEncryptionKeyVersion:
        config.services.control_plane_api.integrations.active_master_encryption_key_version,
      masterEncryptionKeys: config.services.control_plane_api.integrations.master_encryption_keys,
    },
  };
}

export function selectControlPlaneApiMaintenanceConfig(
  config: Config,
): ControlPlaneApiMaintenanceConfig {
  return {
    database: {
      migrationUrl: config.postgres.control_plane.direct_url,
    },
    telemetry: projectTelemetry(config),
  };
}

export function selectControlPlaneWorkerConfig(config: Config): ControlPlaneWorkerConfig {
  return {
    database: {
      url: config.postgres.control_plane.pooled_url,
    },
    workflow: {
      databaseUrl: config.postgres.control_plane.direct_url,
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
      baseUrl: config.services.data_plane_api.internal_url,
    },
    controlPlaneApi: {
      baseUrl: config.services.control_plane_api.internal_url,
    },
    internalAuth: {
      serviceToken: config.internal_auth.shared_token.token,
    },
    sandbox: {
      defaultBaseImage: config.sandbox.default_base_image,
    },
  };
}

export function selectDataPlaneApiConfig(config: Config): DataPlaneApiConfig {
  return {
    server: {
      host: config.services.data_plane_api.host,
      port: config.services.data_plane_api.port,
    },
    database: {
      url: config.postgres.data_plane.pooled_url,
      migrationUrl: config.postgres.data_plane.direct_url,
    },
    workflow: {
      databaseUrl: config.postgres.data_plane.direct_url,
      migrationUrl: config.postgres.data_plane.direct_url,
      namespaceId: config.workflow.data_plane.namespace_id,
    },
    runtimeState: {
      gatewayBaseUrl: config.services.data_plane_gateway.internal_url,
    },
    controlPlaneApi: {
      baseUrl: config.services.control_plane_api.internal_url,
    },
    internalAuth: {
      serviceToken: config.internal_auth.shared_token.token,
    },
    sandbox: {
      provider: config.sandbox.provider,
      storage:
        config.sandbox.storage === undefined
          ? undefined
          : {
              backend: config.sandbox.storage.backend,
            },
      docker: config.sandbox.docker
        ? {
            socketPath: config.sandbox.docker.socket_path,
          }
        : undefined,
    },
  };
}

export function selectDataPlaneGatewayConfig(config: Config): DataPlaneGatewayConfig {
  const globalConfig = selectGlobalConfig(config);

  return {
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
      baseUrl: config.services.data_plane_api.internal_url,
    },
    controlPlaneApi: {
      baseUrl: config.services.control_plane_api.internal_url,
      publicBaseUrl: config.services.control_plane_api.public_url,
    },
    internalAuth: {
      serviceToken: config.internal_auth.shared_token.token,
    },
    sandbox: globalConfig.sandbox,
    telemetry: globalConfig.telemetry,
  };
}

export function selectDataPlaneWorkerConfig(config: Config): DataPlaneWorkerConfig {
  const sandboxStorage =
    config.sandbox.storage === undefined
      ? undefined
      : {
          backend: config.sandbox.storage.backend,
        };

  return {
    database: {
      url: config.postgres.data_plane.pooled_url,
    },
    workflow: {
      databaseUrl: config.postgres.data_plane.direct_url,
      namespaceId: config.workflow.data_plane.namespace_id,
      runMigrations: false,
      concurrency: config.services.data_plane_worker.workflow_concurrency,
    },
    runtimeState: {
      gatewayBaseUrl: config.services.data_plane_gateway.internal_url,
    },
    controlPlaneApi: {
      baseUrl: config.services.control_plane_api.internal_url,
    },
    sandbox: {
      provider: config.sandbox.provider,
      storage: sandboxStorage,
      internalGatewayWsUrl: config.services.data_plane_gateway.sandbox_ws_internal_url,
      bootstrap: {
        tokenSecret: config.sandbox.tokens.bootstrap.secret,
        tokenIssuer: config.sandbox.tokens.bootstrap.issuer,
        tokenAudience: config.sandbox.tokens.bootstrap.audience,
      },
      ...(config.sandbox.sandboxd_test_faults_enabled === undefined
        ? {}
        : { sandboxdTestFaultsEnabled: config.sandbox.sandboxd_test_faults_enabled }),
      docker:
        config.sandbox.docker === undefined
          ? undefined
          : {
              socketPath: config.sandbox.docker.socket_path,
              networkName: config.sandbox.docker.network_name,
            },
    },
    sandboxStorage: buildSandboxStorage(config),
    internalAuth: {
      serviceToken: config.internal_auth.shared_token.token,
    },
    telemetry: projectTelemetry(config),
  };
}
