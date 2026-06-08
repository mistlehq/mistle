import type {
  ControlPlaneApiConfig,
  ControlPlaneApiMaintenanceConfig,
} from "../apps/control-plane-api/schema.js";
import type { ControlPlaneWorkerConfig } from "../apps/control-plane-worker/schema.js";
import type { DataPlaneApiConfig } from "../apps/data-plane-api/schema.js";
import type { DataPlaneGatewayConfig } from "../apps/data-plane-gateway/schema.js";
import type { DataPlaneWorkerConfig } from "../apps/data-plane-worker/schema.js";
import type { GlobalConfig, GlobalTelemetryConfig } from "../global/schema.js";
import { type Config } from "./schema.js";

function selectControlPlaneWorkerStripeBillingConfig(
  config: Config,
): ControlPlaneWorkerConfig["billing"]["stripe"] {
  if (config.billing.stripe.enabled === true) {
    return {
      enabled: true,
      secretKey: config.billing.stripe.secret_key,
    };
  }

  if (config.billing.stripe.secret_key === undefined) {
    return {
      enabled: false,
    };
  }

  return {
    enabled: false,
    secretKey: config.billing.stripe.secret_key,
  };
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
  return {
    env: config.global.env,
    telemetry: projectTelemetry(config),
    internalAuth: {
      serviceToken: config.internal_auth.shared_token.token,
    },
    sandbox: {
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
      ptyTransport: {
        tokenSecret: config.sandbox.tokens.pty_transport.secret,
        tokenIssuer: config.sandbox.tokens.pty_transport.issuer,
        tokenAudience: config.sandbox.tokens.pty_transport.audience,
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
    cache:
      config.kv.control_plane === undefined
        ? {
            backend: "memory",
          }
        : {
            backend: "valkey",
            valkey: {
              url: config.kv.control_plane.url,
              keyPrefix: config.kv.control_plane.key_prefix,
            },
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
      welcomeEmail:
        config.services.control_plane_api.auth.welcome_email.enabled === true
          ? config.services.control_plane_api.auth.welcome_email.call_url === undefined
            ? {
                enabled: true,
              }
            : {
                enabled: true,
                callUrl: config.services.control_plane_api.auth.welcome_email.call_url,
              }
          : {
              enabled: false,
            },
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
    mcp: {
      url: config.services.control_plane_api.mcp.url,
      trustForwardedHeaders: config.services.control_plane_api.mcp.trust_forwarded_headers,
      auth: {
        secret: config.services.control_plane_api.mcp.auth.secret,
        issuer: config.services.control_plane_api.mcp.auth.issuer,
        audience: config.services.control_plane_api.mcp.auth.audience,
      },
    },
    dashboard: {
      baseUrl: config.services.dashboard.public_url,
    },
    billing: {
      stripe: {
        enabled: config.billing.stripe.enabled,
      },
    },
    workflow: {
      databaseUrl: config.postgres.control_plane.direct_url,
      migrationUrl: config.postgres.control_plane.direct_url,
      namespaceId: config.workflow.control_plane.namespace_id,
      databasePoolMax: config.services.control_plane_api.workflow_database_pool_max,
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
    ptyTransport: {
      tokenSecret: config.sandbox.tokens.pty_transport.secret,
      tokenIssuer: config.sandbox.tokens.pty_transport.issuer,
      tokenAudience: config.sandbox.tokens.pty_transport.audience,
    },
    sandbox: {
      defaultBaseImage: config.sandbox.default_base_image,
      gatewayWsUrl: config.services.data_plane_gateway.sandbox_ws_public_url,
      bootstrap: {
        tokenSecret: config.sandbox.tokens.bootstrap.secret,
        tokenIssuer: config.sandbox.tokens.bootstrap.issuer,
        tokenAudience: config.sandbox.tokens.bootstrap.audience,
      },
      docker: {
        enabled: config.sandbox.docker?.enabled === true,
      },
      ...(config.sandbox.e2b?.enabled === true
        ? {
            e2b: {
              enabled: true,
              apiKey: config.sandbox.e2b.api_key,
              domain: config.sandbox.e2b.domain,
            },
          }
        : config.sandbox.e2b?.enabled === false
          ? { e2b: { enabled: false } }
          : {}),
      ...(config.sandbox.tensorlake?.enabled === true
        ? {
            tensorlake: {
              enabled: true,
              apiKey: config.sandbox.tensorlake.api_key,
            },
          }
        : config.sandbox.tensorlake?.enabled === false
          ? { tensorlake: { enabled: false } }
          : {}),
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
      controlPlaneMigrationUrl: config.postgres.control_plane.direct_url,
      dataPlaneMigrationUrl: config.postgres.data_plane.direct_url,
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
      databasePoolMax: config.services.control_plane_worker.workflow_database_pool_max,
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
    billing: {
      stripe: selectControlPlaneWorkerStripeBillingConfig(config),
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
      databasePoolMax: config.services.data_plane_api.workflow_database_pool_max,
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
      docker:
        config.sandbox.docker?.enabled === true
          ? {
              enabled: true,
              socketPath: config.sandbox.docker.socket_path,
            }
          : config.sandbox.docker?.enabled === false
            ? { enabled: false }
            : undefined,
      e2b:
        config.sandbox.e2b?.enabled === true
          ? {
              enabled: true,
              apiKey: config.sandbox.e2b.api_key,
              domain: config.sandbox.e2b.domain,
            }
          : config.sandbox.e2b?.enabled === false
            ? { enabled: false }
            : undefined,
      tensorlake:
        config.sandbox.tensorlake?.enabled === true
          ? {
              enabled: true,
              apiKey: config.sandbox.tensorlake.api_key,
            }
          : config.sandbox.tensorlake?.enabled === false
            ? { enabled: false }
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
    gatewayRelay:
      config.gateway_relay.backend === "nats"
        ? {
            backend: "nats",
            nats: {
              url: config.gateway_relay.nats.url,
              namePrefix: config.gateway_relay.nats.name_prefix,
            },
          }
        : {
            backend: "memory",
          },
    health: {
      websocketPingIntervalMs:
        config.services.data_plane_gateway.health?.websocket_ping_interval_ms ?? 10_000,
      websocketPongTimeoutMs:
        config.services.data_plane_gateway.health?.websocket_pong_timeout_ms ?? 10_000,
    },
    dataPlaneApi: {
      baseUrl: config.services.data_plane_api.internal_url,
    },
    controlPlaneApi: {
      baseUrl: config.services.control_plane_api.internal_url,
      publicBaseUrl: config.services.control_plane_api.public_url,
      mcp: {
        auth: {
          secret: config.services.control_plane_api.mcp.auth.secret,
          issuer: config.services.control_plane_api.mcp.auth.issuer,
          audience: config.services.control_plane_api.mcp.auth.audience,
        },
      },
    },
    internalAuth: {
      serviceToken: config.internal_auth.shared_token.token,
    },
    sandbox: globalConfig.sandbox,
    telemetry: globalConfig.telemetry,
  };
}

export function selectDataPlaneWorkerConfig(config: Config): DataPlaneWorkerConfig {
  return {
    database: {
      url: config.postgres.data_plane.pooled_url,
    },
    workflow: {
      databaseUrl: config.postgres.data_plane.direct_url,
      namespaceId: config.workflow.data_plane.namespace_id,
      runMigrations: false,
      concurrency: config.services.data_plane_worker.workflow_concurrency,
      databasePoolMax: config.services.data_plane_worker.workflow_database_pool_max,
    },
    runtimeState: {
      gatewayBaseUrl: config.services.data_plane_gateway.internal_url,
    },
    controlPlaneApi: {
      baseUrl: config.services.control_plane_api.internal_url,
    },
    sandbox: {
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
        config.sandbox.docker?.enabled === true
          ? {
              enabled: true,
              socketPath: config.sandbox.docker.socket_path,
              networkName: config.sandbox.docker.network_name,
            }
          : config.sandbox.docker?.enabled === false
            ? { enabled: false }
            : undefined,
      e2b:
        config.sandbox.e2b?.enabled === true
          ? {
              enabled: true,
              apiKey: config.sandbox.e2b.api_key,
              domain: config.sandbox.e2b.domain,
              cpuCount: config.sandbox.e2b.cpu_count,
              memoryMb: config.sandbox.e2b.memory_mb,
            }
          : config.sandbox.e2b?.enabled === false
            ? { enabled: false }
            : undefined,
      tensorlake:
        config.sandbox.tensorlake?.enabled === true
          ? {
              enabled: true,
              apiKey: config.sandbox.tensorlake.api_key,
            }
          : config.sandbox.tensorlake?.enabled === false
            ? { enabled: false }
            : undefined,
    },
    internalAuth: {
      serviceToken: config.internal_auth.shared_token.token,
    },
    telemetry: projectTelemetry(config),
  };
}
