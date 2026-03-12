# Data Plane Worker Config Module

Namespace in final config:

- `apps.data_plane_worker`

## Config Keys

| Key                                   | Type                  | Description                                                        | Default | TOML                                                               | Env                                                                           |
| ------------------------------------- | --------------------- | ------------------------------------------------------------------ | ------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `server.host`                         | `string`              | Host/interface for the data-plane worker health server bind.       | None    | `[apps.data_plane_worker.server].host`                             | `MISTLE_APPS_DATA_PLANE_WORKER_HOST`                                          |
| `server.port`                         | `number` (`1..65535`) | Port for the data-plane worker health server bind.                 | None    | `[apps.data_plane_worker.server].port`                             | `MISTLE_APPS_DATA_PLANE_WORKER_PORT` (`Number`)                               |
| `database.url`                        | `string`              | Runtime Postgres connection URL for data-plane worker state.       | None    | `[apps.data_plane_worker.database].url`                            | `MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL`                                  |
| `workflow.databaseUrl`                | `string`              | Postgres URL used by OpenWorkflow backend in data-plane.           | None    | `[apps.data_plane_worker.workflow].database_url`                   | `MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL`                         |
| `workflow.namespaceId`                | `string`              | OpenWorkflow namespace id used by the data-plane worker.           | None    | `[apps.data_plane_worker.workflow].namespace_id`                   | `MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID`                         |
| `workflow.runMigrations`              | `boolean`             | Whether worker startup runs OpenWorkflow schema migrations.        | None    | `[apps.data_plane_worker.workflow].run_migrations`                 | `MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS` (`true/false`)        |
| `workflow.concurrency`                | `number` (`>=1`)      | OpenWorkflow worker concurrency for data-plane workflows.          | None    | `[apps.data_plane_worker.workflow].concurrency`                    | `MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY` (`Number`)               |
| `tunnel.bootstrapTokenTtlSeconds`     | `number` (`>=1`)      | Lifetime for sandbox bootstrap tunnel token in seconds.            | None    | `[apps.data_plane_worker.tunnel].bootstrap_token_ttl_seconds`      | `MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_BOOTSTRAP_TOKEN_TTL_SECONDS` (`Number`) |
| `sandbox.tokenizerProxyEgressBaseUrl` | `string`              | Base URL used for sandbox-runtime tokenizer proxy egress hops.     | None    | `[apps.data_plane_worker.sandbox].tokenizer_proxy_egress_base_url` | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL`       |
| `sandbox.modal.tokenId`               | `string`              | Modal token id used when provider is modal.                        | None    | `[apps.data_plane_worker.sandbox.modal].token_id`                  | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_TOKEN_ID`                        |
| `sandbox.modal.tokenSecret`           | `string`              | Modal token secret used when provider is modal.                    | None    | `[apps.data_plane_worker.sandbox.modal].token_secret`              | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_TOKEN_SECRET`                    |
| `sandbox.modal.appName`               | `string`              | Modal app name used for sandbox lifecycle calls.                   | None    | `[apps.data_plane_worker.sandbox.modal].app_name`                  | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_APP_NAME`                        |
| `sandbox.modal.environmentName`       | `string` (optional)   | Optional Modal environment override.                               | None    | `[apps.data_plane_worker.sandbox.modal].environment_name`          | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_ENVIRONMENT_NAME`                |
| `sandbox.docker.socketPath`           | `string`              | Docker daemon socket path used when provider is docker.            | None    | `[apps.data_plane_worker.sandbox.docker].socket_path`              | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH`                    |
| `sandbox.docker.snapshotRepository`   | `string`              | OCI repository used for docker snapshot push/pull by digest.       | None    | `[apps.data_plane_worker.sandbox.docker].snapshot_repository`      | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SNAPSHOT_REPOSITORY`            |
| `sandbox.docker.networkName`          | `string` (optional)   | Optional Docker network name that sandbox containers join.         | None    | `[apps.data_plane_worker.sandbox.docker].network_name`             | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_NETWORK_NAME`                   |
| `sandbox.docker.tracesEndpoint`       | `string` (optional)   | Optional sandbox-facing OTLP traces endpoint for Docker sandboxes. | None    | `[apps.data_plane_worker.sandbox.docker].traces_endpoint`          | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_TRACES_ENDPOINT`                |

Notes:

- Sandbox provider selection now comes from `global.sandbox.provider`.
- `apps.data_plane_worker.sandbox` only carries provider-specific runtime settings plus `tokenizer_proxy_egress_base_url`.
