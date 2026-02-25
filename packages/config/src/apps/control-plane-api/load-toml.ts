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
  const email = asObjectRecord(controlPlaneApi.email);

  return PartialControlPlaneApiConfigSchema.parse({
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
    email: {
      fromAddress: email.from_address,
      fromName: email.from_name,
      smtpHost: email.smtp_host,
      smtpPort: email.smtp_port,
      smtpSecure: email.smtp_secure,
      smtpUsername: email.smtp_username,
      smtpPassword: email.smtp_password,
    },
  });
}
