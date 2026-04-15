# Data Plane Worker Config Module

Namespace in final config:

- `apps.data_plane_worker`

## Config Keys

| Key                                   | Type                | Description                                                        | Default   | TOML                                                               | Env                                                                           |
| ------------------------------------- | ------------------- | ------------------------------------------------------------------ | --------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `database.url`                        | `string`            | Runtime Postgres connection URL for data-plane worker state.       | None      | `[apps.data_plane_worker.database].url`                            | `MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL`                                  |
| `workflow.databaseUrl`                | `string`            | Postgres URL used by OpenWorkflow backend in data-plane.           | None      | `[apps.data_plane_worker.workflow].database_url`                   | `MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL`                         |
| `workflow.namespaceId`                | `string`            | OpenWorkflow namespace id used by the data-plane worker.           | None      | `[apps.data_plane_worker.workflow].namespace_id`                   | `MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID`                         |
| `workflow.runMigrations`              | `boolean`           | Whether worker startup runs OpenWorkflow schema migrations.        | None      | `[apps.data_plane_worker.workflow].run_migrations`                 | `MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS` (`true/false`)        |
| `workflow.concurrency`                | `number` (`>=1`)    | OpenWorkflow worker concurrency for data-plane workflows.          | None      | `[apps.data_plane_worker.workflow].concurrency`                    | `MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY` (`Number`)               |
| `tunnel.bootstrapTokenTtlSeconds`     | `number` (`>=1`)    | Lifetime for sandbox bootstrap tunnel token in seconds.            | None      | `[apps.data_plane_worker.tunnel].bootstrap_token_ttl_seconds`      | `MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_BOOTSTRAP_TOKEN_TTL_SECONDS` (`Number`) |
| `tunnel.exchangeTokenTtlSeconds`      | `number` (`>=1`)    | Lifetime for sandbox tunnel exchange token in seconds.             | None      | `[apps.data_plane_worker.tunnel].exchange_token_ttl_seconds`       | `MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_EXCHANGE_TOKEN_TTL_SECONDS` (`Number`)  |
| `runtimeState.gatewayBaseUrl`         | `string`            | Internal gateway base URL used for worker runtime-state reads.     | None      | `[apps.data_plane_worker.runtime_state].gateway_base_url`          | `MISTLE_APPS_DATA_PLANE_WORKER_RUNTIME_STATE_GATEWAY_BASE_URL`                |
| `controlPlaneApi.baseUrl`             | `string`            | Required internal control-plane API base URL used by worker flows. | None      | `[apps.data_plane_worker.control_plane_api].base_url`              | `MISTLE_APPS_DATA_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL`                    |
| `sandbox.tokenizerProxyEgressBaseUrl` | `string`            | Base URL used for sandbox-runtime tokenizer proxy egress hops.     | None      | `[apps.data_plane_worker.sandbox].tokenizer_proxy_egress_base_url` | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL`       |
| `sandbox.sandboxdTestFaultsEnabled`   | `boolean`           | Enables sandboxd test-only fault routes in sandbox-local envs.     | None      | `[apps.data_plane_worker.sandbox].sandboxd_test_faults_enabled`    | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_SANDBOXD_TEST_FAULTS_ENABLED`          |
| `sandbox.docker.socketPath`           | `string`            | Docker daemon socket path used when provider is docker.            | None      | `[apps.data_plane_worker.sandbox.docker].socket_path`              | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH`                    |
| `sandbox.docker.networkName`          | `string` (optional) | Optional Docker network name that sandbox containers join.         | None      | `[apps.data_plane_worker.sandbox.docker].network_name`             | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_NETWORK_NAME`                   |
| `sandbox.e2b.apiKey`                  | `string`            | E2B API key used when provider is e2b.                             | None      | `[apps.data_plane_worker.sandbox.e2b].api_key`                     | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_API_KEY`                           |
| `sandbox.e2b.domain`                  | `string` (optional) | Optional E2B domain override.                                      | `e2b.app` | `[apps.data_plane_worker.sandbox.e2b].domain`                      | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_DOMAIN`                            |
| `sandbox.e2b.cpuCount`                | `number` (`>=1`)    | Optional E2B template CPU default used for new sandboxes.          | `2`       | `[apps.data_plane_worker.sandbox.e2b].cpu_count`                   | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_CPU_COUNT`                         |
| `sandbox.e2b.memoryMb`                | `number` (`>=1`)    | Optional E2B template memory default in MB for new sandboxes.      | `4096`    | `[apps.data_plane_worker.sandbox.e2b].memory_mb`                   | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_MEMORY_MB`                         |
| `sandboxStorage.archil.apiKey`        | `string`            | Managed Archil API key used for durable sandbox provisioning.      | None      | `[apps.data_plane_worker.sandbox_storage.archil].api_key`          | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY`                |
| `sandboxStorage.archil.region`        | `string`            | Deployment-wide Archil region used for managed disks.              | None      | `[apps.data_plane_worker.sandbox_storage.archil].region`           | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION`                 |
| `sandboxStorage.archil.namePrefix`    | `string` (optional) | Optional prefix applied to new Archil disk names.                  | None      | `[apps.data_plane_worker.sandbox_storage.archil].name_prefix`      | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX`            |
| `sandboxStorage.archil.mounts`        | `0..1` entries      | Optional managed Archil mount definition for created disks.        | None      | `[[apps.data_plane_worker.sandbox_storage.archil.mounts]]`         | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON`            |

Notes:

- Sandbox provider selection now comes from `global.sandbox.provider`.
- `apps.data_plane_worker.sandbox` only carries provider-specific runtime settings plus `tokenizer_proxy_egress_base_url`.
- `sandbox.sandboxdTestFaultsEnabled` is intended only for non-release/test environments where sandboxd fault injection must be enabled explicitly.
- Docker and E2B both consume the same `global.sandbox.defaultBaseImage` OCI reference.
- Omitting `sandbox.e2b.cpuCount` or `sandbox.e2b.memoryMb` keeps the built-in E2B defaults of `2` vCPU and `4096` MB.
- `sandboxStorage.archil.mounts` currently supports only `s3-compatible` and must contain at most one entry.
- Archil-backed development and test configs should use a real remote
  S3-compatible bucket. Do not assume a local SeaweedFS endpoint is a
  supported Archil backing store.
