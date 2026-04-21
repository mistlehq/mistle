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
  const objectStore = asObjectRecord(controlPlaneApi.object_store);
  const auth = asObjectRecord(controlPlaneApi.auth);
  const dashboard = asObjectRecord(controlPlaneApi.dashboard);
  const workflow = asObjectRecord(controlPlaneApi.workflow);
  const dataPlaneApi = asObjectRecord(controlPlaneApi.data_plane_api);
  const commitSign = asObjectRecord(controlPlaneApi.commit_sign);
  const integrations = asObjectRecord(controlPlaneApi.integrations);

  let partialConfig: Record<string, unknown> = {
    server: {
      host: server.host,
      port: server.port,
    },
    database: {
      url: database.url,
      migrationUrl: database.migration_url,
    },
    objectStore: {
      bucketName: objectStore.bucket_name,
      region: objectStore.region,
      endpoint: objectStore.endpoint,
      forcePathStyle: objectStore.force_path_style,
      accessKeyId: objectStore.access_key_id,
      secretAccessKey: objectStore.secret_access_key,
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
    ...(hasEntries(commitSign)
      ? {
          commitSign: {
            binaryPath: commitSign.binary_path,
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
