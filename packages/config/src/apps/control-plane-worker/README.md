# Control Plane Worker Config Module

Selected service config:

- `control-plane-worker`

## Config Keys

| Key                       | Type                  | Description                                                            | Default | Env                                                                    |
| ------------------------- | --------------------- | ---------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------- |
| `workflow.databaseUrl`    | `string`              | Postgres URL used by OpenWorkflow backend in the control-plane worker. | None    | `MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL`                             |
| `workflow.namespaceId`    | `string`              | OpenWorkflow namespace id used by the control-plane worker.            | None    | `MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID`                           |
| `workflow.runMigrations`  | `boolean`             | Whether worker startup runs OpenWorkflow schema migrations.            | `false` | Not operator-configurable                                              |
| `workflow.concurrency`    | `number` (`>=1`)      | OpenWorkflow worker concurrency for control-plane workflows.           | None    | `MISTLE_SERVICES_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY` (`Number`) |
| `email.fromAddress`       | `string`              | Sender email address for workflow-driven control-plane emails.         | None    | `MISTLE_EMAIL_SMTP_FROM_ADDRESS`                                       |
| `email.fromName`          | `string`              | Sender display name for workflow-driven control-plane emails.          | None    | `MISTLE_EMAIL_SMTP_FROM_NAME`                                          |
| `email.smtpHost`          | `string`              | SMTP host used by the control-plane worker for email delivery.         | None    | `MISTLE_EMAIL_SMTP_HOST`                                               |
| `email.smtpPort`          | `number` (`1..65535`) | SMTP port used by the control-plane worker for email delivery.         | None    | `MISTLE_EMAIL_SMTP_PORT` (`Number`)                                    |
| `email.smtpSecure`        | `boolean`             | Whether control-plane worker SMTP requires TLS on connect.             | None    | `MISTLE_EMAIL_SMTP_SECURE` (`true/false`)                              |
| `email.smtpUsername`      | `string`              | SMTP username for control-plane worker email sender authentication.    | None    | `MISTLE_EMAIL_SMTP_USERNAME`                                           |
| `email.smtpPassword`      | `string`              | SMTP password for control-plane worker email sender authentication.    | None    | `MISTLE_EMAIL_SMTP_PASSWORD`                                           |
| `dataPlaneApi.baseUrl`    | `string`              | Base URL for data-plane API calls made by control-plane worker flows.  | None    | `MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL`                          |
| `controlPlaneApi.baseUrl` | `string`              | Base URL for internal control-plane API calls made by worker flows.    | None    | `MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL`                       |

Managed deployments should set `workflow.runMigrations` to `false` and run OpenWorkflow migrations separately.
