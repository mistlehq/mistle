# Data Plane Worker Config Module

Namespace in final config:

- `apps.data_plane_worker`

## Config Keys

| Key                                      | Type                | Description                                                        | Default   | Env                                                                       |
| ---------------------------------------- | ------------------- | ------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------- |
| `database.url`                           | `string`            | Runtime Postgres connection URL for data-plane worker state.       | None      | `MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL`                              |
| `workflow.databaseUrl`                   | `string`            | Postgres URL used by OpenWorkflow backend in data-plane.           | None      | `MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL`                     |
| `workflow.namespaceId`                   | `string`            | OpenWorkflow namespace id used by the data-plane worker.           | None      | `MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID`                     |
| `workflow.runMigrations`                 | `boolean`           | Whether worker startup runs OpenWorkflow schema migrations.        | None      | `MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS` (`true/false`)    |
| `workflow.concurrency`                   | `number` (`>=1`)    | OpenWorkflow worker concurrency for data-plane workflows.          | None      | `MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY` (`Number`)           |
| `runtimeState.gatewayBaseUrl`            | `string`            | Internal gateway base URL used for worker runtime-state reads.     | None      | `MISTLE_APPS_DATA_PLANE_WORKER_RUNTIME_STATE_GATEWAY_BASE_URL`            |
| `controlPlaneApi.baseUrl`                | `string`            | Required internal control-plane API base URL used by worker flows. | None      | `MISTLE_APPS_DATA_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL`                |
| `internalAuth.serviceToken`              | `string`            | Internal service token used by worker service-to-service calls.    | None      | Projected from global config                                              |
| `telemetry`                              | `object`            | Worker telemetry config.                                           | None      | Projected from global config                                              |
| `sandbox.provider`                       | `docker`/`e2b`      | Sandbox runtime provider selected for worker execution.            | None      | Projected from global config                                              |
| `sandbox.storage.backend`                | `string` (optional) | Optional persistent sandbox storage backend selected for workers.  | None      | Projected from global config                                              |
| `sandbox.internalGatewayWsUrl`           | `string`            | Internal gateway websocket URL used by sandbox bootstraps.         | None      | Projected from global config                                              |
| `sandbox.bootstrap`                      | `object`            | Sandbox bootstrap token signing config.                            | None      | Projected from global config                                              |
| `sandbox.egress`                         | `object`            | Sandbox egress grant signing config.                               | None      | Projected from global config                                              |
| `sandbox.tokenizerProxyEgressBaseUrl`    | `string`            | Base URL used for sandbox-runtime tokenizer proxy egress hops.     | None      | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL`   |
| `sandbox.docker.socketPath`              | `string`            | Docker daemon socket path used when provider is docker.            | None      | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH`                |
| `sandbox.docker.networkName`             | `string` (optional) | Optional Docker network name that sandbox containers join.         | None      | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_NETWORK_NAME`               |
| `sandbox.e2b.apiKey`                     | `string`            | E2B API key used when provider is e2b.                             | None      | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_API_KEY`                       |
| `sandbox.e2b.domain`                     | `string` (optional) | Optional E2B domain override.                                      | `e2b.app` | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_DOMAIN`                        |
| `sandbox.e2b.cpuCount`                   | `number` (`>=1`)    | Optional E2B template CPU default used for new sandboxes.          | `2`       | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_CPU_COUNT`                     |
| `sandbox.e2b.memoryMb`                   | `number` (`>=1`)    | Optional E2B template memory default in MB for new sandboxes.      | `4096`    | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_MEMORY_MB`                     |
| `sandboxStorage.dockerVolume.namePrefix` | `string` (optional) | Optional prefix applied to new Docker volume names.                | None      | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX` |
| `sandboxStorage.archil.apiKey`           | `string`            | Managed Archil API key used for durable sandbox provisioning.      | None      | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_API_KEY`            |
| `sandboxStorage.archil.region`           | `string`            | Deployment-wide Archil region used for managed disks.              | None      | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_REGION`             |
| `sandboxStorage.archil.namePrefix`       | `string` (optional) | Optional prefix applied to new Archil disk names.                  | None      | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX`        |
| `sandboxStorage.archil.mounts`           | `0..1` entries      | Optional managed Archil mount definition for created disks.        | None      | `MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_ARCHIL_MOUNTS_JSON`        |

Notes:

- Sandbox provider selection is projected into `apps.data_plane_worker.sandbox.provider`.
- Managed deployments should set `workflow.runMigrations` to `false` and run OpenWorkflow migrations separately.
- `apps.data_plane_worker.sandbox` carries the runtime sandbox dependencies the worker consumes.
- `sandboxStorage.dockerVolume` is only used when `apps.data_plane_worker.sandbox.storage.backend = "docker_volume"`.
- `sandbox.sandboxdTestFaultsEnabled` is intended only for non-release/test environments where sandboxd fault injection must be enabled explicitly.
- Omitting `sandbox.e2b.cpuCount` or `sandbox.e2b.memoryMb` keeps the built-in E2B defaults of `2` vCPU and `4096` MB.
- `sandboxStorage.archil.mounts` currently supports only `s3-compatible` and must contain at most one entry.
- Archil-backed development and test configs should use a real remote
  S3-compatible bucket. Do not assume a local SeaweedFS endpoint is a
  supported Archil backing store.
