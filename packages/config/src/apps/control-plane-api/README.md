# Control Plane API Config Module

Namespace in final config:

- `apps.control_plane_api`

## Config Keys

| Key                            | Type                  | Description                                            | Default | TOML                                                   | Env                                                                    |
| ------------------------------ | --------------------- | ------------------------------------------------------ | ------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `server.host`                  | `string`              | Host/interface for the Control Plane API server bind.  | None    | `[apps.control_plane_api.server].host`                 | `MISTLE_APPS_CONTROL_PLANE_API_HOST`                                   |
| `server.port`                  | `number` (`1..65535`) | Port for the Control Plane API server bind.            | None    | `[apps.control_plane_api.server].port`                 | `MISTLE_APPS_CONTROL_PLANE_API_PORT` (`Number`)                        |
| `database.url`                 | `string`              | Runtime Postgres connection URL for control-plane API. | None    | `[apps.control_plane_api.database].url`                | `MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL`                           |
| `auth.baseUrl`                 | `string`              | Public base URL used by Better Auth.                   | None    | `[apps.control_plane_api.auth].base_url`               | `MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL`                          |
| `auth.secret`                  | `string`              | Better Auth signing secret.                            | None    | `[apps.control_plane_api.auth].secret`                 | `MISTLE_APPS_CONTROL_PLANE_API_AUTH_SECRET`                            |
| `auth.trustedOrigins`          | `string[]`            | Allowed browser origins for auth requests.             | None    | `[apps.control_plane_api.auth].trusted_origins`        | `MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS` (CSV)             |
| `auth.otpLength`               | `number` (`4..12`)    | OTP code length.                                       | None    | `[apps.control_plane_api.auth].otp_length`             | `MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_LENGTH` (`Number`)             |
| `auth.otpExpiresInSeconds`     | `number` (`>=30`)     | OTP expiration window in seconds.                      | None    | `[apps.control_plane_api.auth].otp_expires_in_seconds` | `MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_EXPIRES_IN_SECONDS` (`Number`) |
| `auth.otpAllowedAttempts`      | `number` (`1..10`)    | Maximum OTP verification attempts.                     | None    | `[apps.control_plane_api.auth].otp_allowed_attempts`   | `MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_ALLOWED_ATTEMPTS` (`Number`)   |
| `email.fromAddress`            | `string`              | Sender email address for OTP emails.                   | None    | `[apps.control_plane_api.email].from_address`          | `MISTLE_APPS_CONTROL_PLANE_API_EMAIL_FROM_ADDRESS`                     |
| `email.fromName`               | `string`              | Sender display name for OTP emails.                    | None    | `[apps.control_plane_api.email].from_name`             | `MISTLE_APPS_CONTROL_PLANE_API_EMAIL_FROM_NAME`                        |
| `email.smtpHost`               | `string`              | SMTP host for OTP email delivery.                      | None    | `[apps.control_plane_api.email].smtp_host`             | `MISTLE_APPS_CONTROL_PLANE_API_SMTP_HOST`                              |
| `email.smtpPort`               | `number` (`1..65535`) | SMTP port for OTP email delivery.                      | None    | `[apps.control_plane_api.email].smtp_port`             | `MISTLE_APPS_CONTROL_PLANE_API_SMTP_PORT` (`Number`)                   |
| `email.smtpSecure`             | `boolean`             | Whether SMTP requires TLS on connect.                  | None    | `[apps.control_plane_api.email].smtp_secure`           | `MISTLE_APPS_CONTROL_PLANE_API_SMTP_SECURE` (`true/false`)             |
| `email.smtpUsername`           | `string`              | SMTP username for OTP sender auth.                     | None    | `[apps.control_plane_api.email].smtp_username`         | `MISTLE_APPS_CONTROL_PLANE_API_SMTP_USERNAME`                          |
| `email.smtpPassword`           | `string`              | SMTP password for OTP sender auth.                     | None    | `[apps.control_plane_api.email].smtp_password`         | `MISTLE_APPS_CONTROL_PLANE_API_SMTP_PASSWORD`                          |
