import { hasEntries } from "../../core/load-env.js";
import { asObjectRecord } from "../../core/record.js";
import {
  type PartialControlPlaneApiConfigInput,
  PartialControlPlaneApiConfigSchema,
} from "./schema.js";

export function loadControlPlaneApiFromToml(
  tomlRoot: Record<string, unknown>,
): PartialControlPlaneApiConfigInput {
  const apps = asObjectRecord(tomlRoot.apps);
  const controlPlaneApi = asObjectRecord(apps.control_plane_api);
  const server = asObjectRecord(controlPlaneApi.server);
  const database = asObjectRecord(controlPlaneApi.database);
  const auth = asObjectRecord(controlPlaneApi.auth);
  const workflow = asObjectRecord(controlPlaneApi.workflow);
  const dataPlaneApi = asObjectRecord(controlPlaneApi.data_plane_api);
  const sandbox = asObjectRecord(controlPlaneApi.sandbox);
  const integrations = asObjectRecord(controlPlaneApi.integrations);

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
      invitationAcceptBaseUrl: auth.invitation_accept_base_url,
      secret: auth.secret,
      trustedOrigins: auth.trusted_origins,
      otpLength: auth.otp_length,
      otpExpiresInSeconds: auth.otp_expires_in_seconds,
      otpAllowedAttempts: auth.otp_allowed_attempts,
    },
    workflow: {
      databaseUrl: workflow.database_url,
      namespaceId: workflow.namespace_id,
    },
    dataPlaneApi: {
      baseUrl: dataPlaneApi.base_url,
    },
    sandbox: {
      defaultBaseImage: sandbox.default_base_image,
      gatewayWsUrl: sandbox.gateway_ws_url,
      bootstrapTokenTtlSeconds: sandbox.bootstrap_token_ttl_seconds,
    },
  };

  if (hasEntries(integrations)) {
    partialConfig = {
      ...partialConfig,
      integrations: {
        activeMasterEncryptionKeyVersion: integrations.active_master_encryption_key_version,
        masterEncryptionKeys: asObjectRecord(integrations.master_encryption_keys),
      },
    };
  }

  return PartialControlPlaneApiConfigSchema.parse(partialConfig);
}
