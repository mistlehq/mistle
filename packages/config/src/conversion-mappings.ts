export type EnvValueFormat = "default" | "csv" | "json";

export type ConfigEnvTomlMapping = {
  configPath: readonly string[];
  tomlPath: readonly string[];
  envVar: string;
  envValueFormat?: EnvValueFormat;
};

export const configEnvTomlMappings: readonly ConfigEnvTomlMapping[] = [
  {
    configPath: ["global", "env"],
    tomlPath: ["global", "env"],
    envVar: "NODE_ENV",
  },
  {
    configPath: ["global", "internalAuth", "serviceToken"],
    tomlPath: ["global", "internal_auth", "service_token"],
    envVar: "MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN",
  },
  {
    configPath: ["global", "tunnel", "bootstrapTokenSecret"],
    tomlPath: ["global", "tunnel", "bootstrap_token_secret"],
    envVar: "MISTLE_GLOBAL_TUNNEL_BOOTSTRAP_TOKEN_SECRET",
  },
  {
    configPath: ["global", "tunnel", "tokenIssuer"],
    tomlPath: ["global", "tunnel", "token_issuer"],
    envVar: "MISTLE_GLOBAL_TUNNEL_TOKEN_ISSUER",
  },
  {
    configPath: ["global", "tunnel", "tokenAudience"],
    tomlPath: ["global", "tunnel", "token_audience"],
    envVar: "MISTLE_GLOBAL_TUNNEL_TOKEN_AUDIENCE",
  },
  {
    configPath: ["global", "connectionTokens", "secret"],
    tomlPath: ["global", "connection_tokens", "secret"],
    envVar: "MISTLE_GLOBAL_CONNECTION_TOKENS_SECRET",
  },
  {
    configPath: ["global", "connectionTokens", "issuer"],
    tomlPath: ["global", "connection_tokens", "issuer"],
    envVar: "MISTLE_GLOBAL_CONNECTION_TOKENS_ISSUER",
  },
  {
    configPath: ["global", "connectionTokens", "audience"],
    tomlPath: ["global", "connection_tokens", "audience"],
    envVar: "MISTLE_GLOBAL_CONNECTION_TOKENS_AUDIENCE",
  },
  {
    configPath: ["apps", "control_plane_api", "server", "host"],
    tomlPath: ["apps", "control_plane_api", "server", "host"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_HOST",
  },
  {
    configPath: ["apps", "control_plane_api", "server", "port"],
    tomlPath: ["apps", "control_plane_api", "server", "port"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_PORT",
  },
  {
    configPath: ["apps", "control_plane_api", "database", "url"],
    tomlPath: ["apps", "control_plane_api", "database", "url"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL",
  },
  {
    configPath: ["apps", "control_plane_api", "auth", "baseUrl"],
    tomlPath: ["apps", "control_plane_api", "auth", "base_url"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL",
  },
  {
    configPath: ["apps", "control_plane_api", "auth", "invitationAcceptBaseUrl"],
    tomlPath: ["apps", "control_plane_api", "auth", "invitation_accept_base_url"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_INVITATION_ACCEPT_BASE_URL",
  },
  {
    configPath: ["apps", "control_plane_api", "auth", "secret"],
    tomlPath: ["apps", "control_plane_api", "auth", "secret"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_SECRET",
  },
  {
    configPath: ["apps", "control_plane_api", "auth", "trustedOrigins"],
    tomlPath: ["apps", "control_plane_api", "auth", "trusted_origins"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS",
    envValueFormat: "csv",
  },
  {
    configPath: ["apps", "control_plane_api", "auth", "otpLength"],
    tomlPath: ["apps", "control_plane_api", "auth", "otp_length"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_LENGTH",
  },
  {
    configPath: ["apps", "control_plane_api", "auth", "otpExpiresInSeconds"],
    tomlPath: ["apps", "control_plane_api", "auth", "otp_expires_in_seconds"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_EXPIRES_IN_SECONDS",
  },
  {
    configPath: ["apps", "control_plane_api", "auth", "otpAllowedAttempts"],
    tomlPath: ["apps", "control_plane_api", "auth", "otp_allowed_attempts"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_ALLOWED_ATTEMPTS",
  },
  {
    configPath: ["apps", "control_plane_api", "workflow", "databaseUrl"],
    tomlPath: ["apps", "control_plane_api", "workflow", "database_url"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_DATABASE_URL",
  },
  {
    configPath: ["apps", "control_plane_api", "workflow", "namespaceId"],
    tomlPath: ["apps", "control_plane_api", "workflow", "namespace_id"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID",
  },
  {
    configPath: ["apps", "control_plane_api", "dataPlaneApi", "baseUrl"],
    tomlPath: ["apps", "control_plane_api", "data_plane_api", "base_url"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL",
  },
  {
    configPath: ["apps", "control_plane_api", "sandbox", "defaultBaseImage"],
    tomlPath: ["apps", "control_plane_api", "sandbox", "default_base_image"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_SANDBOX_DEFAULT_BASE_IMAGE",
  },
  {
    configPath: ["apps", "control_plane_api", "sandbox", "gatewayWsUrl"],
    tomlPath: ["apps", "control_plane_api", "sandbox", "gateway_ws_url"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_SANDBOX_GATEWAY_WS_URL",
  },
  {
    configPath: ["apps", "control_plane_api", "integrations", "activeMasterEncryptionKeyVersion"],
    tomlPath: ["apps", "control_plane_api", "integrations", "active_master_encryption_key_version"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION",
  },
  {
    configPath: ["apps", "control_plane_api", "integrations", "masterEncryptionKeys"],
    tomlPath: ["apps", "control_plane_api", "integrations", "master_encryption_keys"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON",
    envValueFormat: "json",
  },
  {
    configPath: ["apps", "control_plane_worker", "server", "host"],
    tomlPath: ["apps", "control_plane_worker", "server", "host"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_HOST",
  },
  {
    configPath: ["apps", "control_plane_worker", "server", "port"],
    tomlPath: ["apps", "control_plane_worker", "server", "port"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_PORT",
  },
  {
    configPath: ["apps", "control_plane_worker", "workflow", "databaseUrl"],
    tomlPath: ["apps", "control_plane_worker", "workflow", "database_url"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL",
  },
  {
    configPath: ["apps", "control_plane_worker", "workflow", "namespaceId"],
    tomlPath: ["apps", "control_plane_worker", "workflow", "namespace_id"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID",
  },
  {
    configPath: ["apps", "control_plane_worker", "workflow", "runMigrations"],
    tomlPath: ["apps", "control_plane_worker", "workflow", "run_migrations"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS",
  },
  {
    configPath: ["apps", "control_plane_worker", "workflow", "concurrency"],
    tomlPath: ["apps", "control_plane_worker", "workflow", "concurrency"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY",
  },
  {
    configPath: ["apps", "control_plane_worker", "email", "fromAddress"],
    tomlPath: ["apps", "control_plane_worker", "email", "from_address"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_ADDRESS",
  },
  {
    configPath: ["apps", "control_plane_worker", "email", "fromName"],
    tomlPath: ["apps", "control_plane_worker", "email", "from_name"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_NAME",
  },
  {
    configPath: ["apps", "control_plane_worker", "email", "smtpHost"],
    tomlPath: ["apps", "control_plane_worker", "email", "smtp_host"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST",
  },
  {
    configPath: ["apps", "control_plane_worker", "email", "smtpPort"],
    tomlPath: ["apps", "control_plane_worker", "email", "smtp_port"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT",
  },
  {
    configPath: ["apps", "control_plane_worker", "email", "smtpSecure"],
    tomlPath: ["apps", "control_plane_worker", "email", "smtp_secure"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE",
  },
  {
    configPath: ["apps", "control_plane_worker", "email", "smtpUsername"],
    tomlPath: ["apps", "control_plane_worker", "email", "smtp_username"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_USERNAME",
  },
  {
    configPath: ["apps", "control_plane_worker", "email", "smtpPassword"],
    tomlPath: ["apps", "control_plane_worker", "email", "smtp_password"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PASSWORD",
  },
  {
    configPath: ["apps", "control_plane_worker", "dataPlaneApi", "baseUrl"],
    tomlPath: ["apps", "control_plane_worker", "data_plane_api", "base_url"],
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL",
  },
  {
    configPath: ["apps", "data_plane_api", "server", "host"],
    tomlPath: ["apps", "data_plane_api", "server", "host"],
    envVar: "MISTLE_APPS_DATA_PLANE_API_HOST",
  },
  {
    configPath: ["apps", "data_plane_api", "server", "port"],
    tomlPath: ["apps", "data_plane_api", "server", "port"],
    envVar: "MISTLE_APPS_DATA_PLANE_API_PORT",
  },
  {
    configPath: ["apps", "data_plane_api", "database", "url"],
    tomlPath: ["apps", "data_plane_api", "database", "url"],
    envVar: "MISTLE_APPS_DATA_PLANE_API_DATABASE_URL",
  },
  {
    configPath: ["apps", "data_plane_api", "workflow", "databaseUrl"],
    tomlPath: ["apps", "data_plane_api", "workflow", "database_url"],
    envVar: "MISTLE_APPS_DATA_PLANE_API_WORKFLOW_DATABASE_URL",
  },
  {
    configPath: ["apps", "data_plane_api", "workflow", "namespaceId"],
    tomlPath: ["apps", "data_plane_api", "workflow", "namespace_id"],
    envVar: "MISTLE_APPS_DATA_PLANE_API_WORKFLOW_NAMESPACE_ID",
  },
  {
    configPath: ["apps", "data_plane_gateway", "server", "host"],
    tomlPath: ["apps", "data_plane_gateway", "server", "host"],
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_HOST",
  },
  {
    configPath: ["apps", "data_plane_gateway", "server", "port"],
    tomlPath: ["apps", "data_plane_gateway", "server", "port"],
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_PORT",
  },
  {
    configPath: ["apps", "data_plane_gateway", "database", "url"],
    tomlPath: ["apps", "data_plane_gateway", "database", "url"],
    envVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_DATABASE_URL",
  },
  {
    configPath: ["apps", "data_plane_worker", "server", "host"],
    tomlPath: ["apps", "data_plane_worker", "server", "host"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_HOST",
  },
  {
    configPath: ["apps", "data_plane_worker", "server", "port"],
    tomlPath: ["apps", "data_plane_worker", "server", "port"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_PORT",
  },
  {
    configPath: ["apps", "data_plane_worker", "database", "url"],
    tomlPath: ["apps", "data_plane_worker", "database", "url"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL",
  },
  {
    configPath: ["apps", "data_plane_worker", "workflow", "databaseUrl"],
    tomlPath: ["apps", "data_plane_worker", "workflow", "database_url"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL",
  },
  {
    configPath: ["apps", "data_plane_worker", "workflow", "namespaceId"],
    tomlPath: ["apps", "data_plane_worker", "workflow", "namespace_id"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID",
  },
  {
    configPath: ["apps", "data_plane_worker", "workflow", "runMigrations"],
    tomlPath: ["apps", "data_plane_worker", "workflow", "run_migrations"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS",
  },
  {
    configPath: ["apps", "data_plane_worker", "workflow", "concurrency"],
    tomlPath: ["apps", "data_plane_worker", "workflow", "concurrency"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY",
  },
  {
    configPath: ["apps", "data_plane_worker", "tunnel", "gatewayWsUrl"],
    tomlPath: ["apps", "data_plane_worker", "tunnel", "gateway_ws_url"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_GATEWAY_WS_URL",
  },
  {
    configPath: ["apps", "data_plane_worker", "tunnel", "bootstrapTokenTtlSeconds"],
    tomlPath: ["apps", "data_plane_worker", "tunnel", "bootstrap_token_ttl_seconds"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_BOOTSTRAP_TOKEN_TTL_SECONDS",
  },
  {
    configPath: ["apps", "data_plane_worker", "sandbox", "provider"],
    tomlPath: ["apps", "data_plane_worker", "sandbox", "provider"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_PROVIDER",
  },
  {
    configPath: ["apps", "data_plane_worker", "sandbox", "tokenizerProxyEgressBaseUrl"],
    tomlPath: ["apps", "data_plane_worker", "sandbox", "tokenizer_proxy_egress_base_url"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL",
  },
  {
    configPath: ["apps", "data_plane_worker", "sandbox", "modal", "tokenId"],
    tomlPath: ["apps", "data_plane_worker", "sandbox", "modal", "token_id"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_TOKEN_ID",
  },
  {
    configPath: ["apps", "data_plane_worker", "sandbox", "modal", "tokenSecret"],
    tomlPath: ["apps", "data_plane_worker", "sandbox", "modal", "token_secret"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_TOKEN_SECRET",
  },
  {
    configPath: ["apps", "data_plane_worker", "sandbox", "modal", "appName"],
    tomlPath: ["apps", "data_plane_worker", "sandbox", "modal", "app_name"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_APP_NAME",
  },
  {
    configPath: ["apps", "data_plane_worker", "sandbox", "modal", "environmentName"],
    tomlPath: ["apps", "data_plane_worker", "sandbox", "modal", "environment_name"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_ENVIRONMENT_NAME",
  },
  {
    configPath: ["apps", "data_plane_worker", "sandbox", "docker", "socketPath"],
    tomlPath: ["apps", "data_plane_worker", "sandbox", "docker", "socket_path"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH",
  },
  {
    configPath: ["apps", "data_plane_worker", "sandbox", "docker", "snapshotRepository"],
    tomlPath: ["apps", "data_plane_worker", "sandbox", "docker", "snapshot_repository"],
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SNAPSHOT_REPOSITORY",
  },
  {
    configPath: ["apps", "tokenizer_proxy", "server", "host"],
    tomlPath: ["apps", "tokenizer_proxy", "server", "host"],
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_HOST",
  },
  {
    configPath: ["apps", "tokenizer_proxy", "server", "port"],
    tomlPath: ["apps", "tokenizer_proxy", "server", "port"],
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_PORT",
  },
  {
    configPath: ["apps", "tokenizer_proxy", "controlPlaneApi", "baseUrl"],
    tomlPath: ["apps", "tokenizer_proxy", "control_plane_api", "base_url"],
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_BASE_URL",
  },
];
