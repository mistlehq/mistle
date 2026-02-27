# Control Plane Worker Config Module

Namespace in final config:

- `apps.control_plane_worker`

## Config Keys

| Key                      | Type                  | Description                                                            | Default | TOML                                                  | Env                                                                       |
| ------------------------ | --------------------- | ---------------------------------------------------------------------- | ------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `server.host`            | `string`              | Host/interface for the control-plane worker health server bind.        | None    | `[apps.control_plane_worker.server].host`             | `MISTLE_APPS_CONTROL_PLANE_WORKER_HOST`                                   |
| `server.port`            | `number` (`1..65535`) | Port for the control-plane worker health server bind.                  | None    | `[apps.control_plane_worker.server].port`             | `MISTLE_APPS_CONTROL_PLANE_WORKER_PORT` (`Number`)                        |
| `workflow.databaseUrl`   | `string`              | Postgres URL used by OpenWorkflow backend in the control-plane worker. | None    | `[apps.control_plane_worker.workflow].database_url`   | `MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL`                  |
| `workflow.namespaceId`   | `string`              | OpenWorkflow namespace id used by the control-plane worker.            | None    | `[apps.control_plane_worker.workflow].namespace_id`   | `MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID`                  |
| `workflow.runMigrations` | `boolean`             | Whether worker startup runs OpenWorkflow schema migrations.            | None    | `[apps.control_plane_worker.workflow].run_migrations` | `MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS` (`true/false`) |
| `workflow.concurrency`   | `number` (`>=1`)      | OpenWorkflow worker concurrency for control-plane workflows.           | None    | `[apps.control_plane_worker.workflow].concurrency`    | `MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY` (`Number`)        |
| `email.fromAddress`      | `string`              | Sender email address for workflow-driven control-plane emails.         | None    | `[apps.control_plane_worker.email].from_address`      | `MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_ADDRESS`                     |
| `email.fromName`         | `string`              | Sender display name for workflow-driven control-plane emails.          | None    | `[apps.control_plane_worker.email].from_name`         | `MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_NAME`                        |
| `email.smtpHost`         | `string`              | SMTP host used by the control-plane worker for email delivery.         | None    | `[apps.control_plane_worker.email].smtp_host`         | `MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST`                              |
| `email.smtpPort`         | `number` (`1..65535`) | SMTP port used by the control-plane worker for email delivery.         | None    | `[apps.control_plane_worker.email].smtp_port`         | `MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT` (`Number`)                   |
| `email.smtpSecure`       | `boolean`             | Whether control-plane worker SMTP requires TLS on connect.             | None    | `[apps.control_plane_worker.email].smtp_secure`       | `MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE` (`true/false`)             |
| `email.smtpUsername`     | `string`              | SMTP username for control-plane worker email sender authentication.    | None    | `[apps.control_plane_worker.email].smtp_username`     | `MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_USERNAME`                          |
| `email.smtpPassword`     | `string`              | SMTP password for control-plane worker email sender authentication.    | None    | `[apps.control_plane_worker.email].smtp_password`     | `MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PASSWORD`                          |
| `dataPlaneApi.baseUrl`   | `string`              | Base URL for data-plane API calls made by control-plane worker flows.  | None    | `[apps.control_plane_worker.data_plane_api].base_url` | `MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL`                |
