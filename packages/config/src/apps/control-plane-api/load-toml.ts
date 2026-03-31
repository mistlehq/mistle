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
  const dashboard = asObjectRecord(controlPlaneApi.dashboard);
  const workflow = asObjectRecord(controlPlaneApi.workflow);
  const dataPlaneApi = asObjectRecord(controlPlaneApi.data_plane_api);
  const integrations = asObjectRecord(controlPlaneApi.integrations);
  const media = asObjectRecord(controlPlaneApi.media);
  const mediaS3 = asObjectRecord(media.s3);

  let partialConfig: Record<string, unknown> = {
    server: {
      host: server.host,
      port: server.port,
    },
    database: {
      url: database.url,
      migrationUrl: database.migration_url,
    },
    auth: {
      baseUrl: auth.base_url,
      secret: auth.secret,
      trustedOrigins: auth.trusted_origins,
      otpLength: auth.otp_length,
      otpExpiresInSeconds: auth.otp_expires_in_seconds,
      otpAllowedAttempts: auth.otp_allowed_attempts,
      ...(auth.google === undefined
        ? {}
        : {
            google: {
              clientId: asObjectRecord(auth.google).client_id,
              clientSecret: asObjectRecord(auth.google).client_secret,
            },
          }),
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
    ...(hasEntries(media)
      ? {
          media: {
            mediaBaseUrl: media.media_base_url,
            bucket: media.bucket,
            provider: media.provider,
            ...(hasEntries(mediaS3)
              ? {
                  s3: {
                    region: mediaS3.region,
                    endpoint: mediaS3.endpoint,
                    accessKeyId: mediaS3.access_key_id,
                    secretAccessKey: mediaS3.secret_access_key,
                    forcePathStyle: mediaS3.force_path_style,
                  },
                }
              : {}),
          },
        }
      : {}),
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
