import { coerceConfigObjectNode } from "../../core/config-object-node.js";
import { hasEntries } from "../../core/load-env.js";
import {
  type PartialControlPlaneApiConfigInput,
  PartialControlPlaneApiConfigSchema,
} from "./schema.js";

export function loadControlPlaneApiFromToml(
  tomlRoot: Record<string, unknown>,
): PartialControlPlaneApiConfigInput {
  const apps = coerceConfigObjectNode(tomlRoot.apps);
  const controlPlaneApi = coerceConfigObjectNode(apps.control_plane_api);
  const server = coerceConfigObjectNode(controlPlaneApi.server);
  const database = coerceConfigObjectNode(controlPlaneApi.database);
  const auth = coerceConfigObjectNode(controlPlaneApi.auth);
  const dashboard = coerceConfigObjectNode(controlPlaneApi.dashboard);
  const workflow = coerceConfigObjectNode(controlPlaneApi.workflow);
  const dataPlaneApi = coerceConfigObjectNode(controlPlaneApi.data_plane_api);
  const integrations = coerceConfigObjectNode(controlPlaneApi.integrations);

  let partialConfig: Record<string, unknown> = {
    server: {
      host: server.host,
      port: server.port,
    },
    database: {
      url: database.url,
    },
    auth: {
      baseUrl: auth.base_url,
      secret: auth.secret,
      trustedOrigins: auth.trusted_origins,
      otpLength: auth.otp_length,
      otpExpiresInSeconds: auth.otp_expires_in_seconds,
      otpAllowedAttempts: auth.otp_allowed_attempts,
    },
    dashboard: {
      baseUrl: dashboard.base_url,
    },
    workflow: {
      databaseUrl: workflow.database_url,
      namespaceId: workflow.namespace_id,
    },
    dataPlaneApi: {
      baseUrl: dataPlaneApi.base_url,
    },
  };

  if (hasEntries(integrations)) {
    partialConfig = {
      ...partialConfig,
      integrations: {
        activeMasterEncryptionKeyVersion: integrations.active_master_encryption_key_version,
        masterEncryptionKeys: coerceConfigObjectNode(integrations.master_encryption_keys),
      },
    };
  }

  return PartialControlPlaneApiConfigSchema.parse(partialConfig);
}
