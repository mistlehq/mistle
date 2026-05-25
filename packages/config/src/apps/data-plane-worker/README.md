# Data Plane Worker Config Module

Selected service config:

- `data-plane-worker`

## Config Keys

| Key                                      | Type                | Description                                                           | Default | Env                                                                                                           |
| ---------------------------------------- | ------------------- | --------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `database.url`                           | `string`            | Runtime Postgres connection URL for data-plane worker state.          | None    | `MISTLE_POSTGRES_DATA_PLANE_POOLED_URL`                                                                       |
| `workflow.databaseUrl`                   | `string`            | Direct Postgres URL used by OpenWorkflow backend in data-plane.       | None    | `MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL`                                                                       |
| `workflow.namespaceId`                   | `string`            | OpenWorkflow namespace id used by the data-plane worker.              | None    | `MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID`                                                                     |
| `workflow.runMigrations`                 | `boolean`           | Whether worker startup runs OpenWorkflow schema migrations.           | `false` | Not operator-configurable                                                                                     |
| `workflow.concurrency`                   | `number` (`>=1`)    | OpenWorkflow worker concurrency for data-plane workflows.             | None    | `MISTLE_SERVICES_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY` (`Number`)                                           |
| `workflow.databasePoolMax`               | `number` (`>=1`)    | Maximum direct Postgres connections for the worker OpenWorkflow pool. | None    | `MISTLE_SERVICES_DATA_PLANE_WORKER_WORKFLOW_DATABASE_POOL_MAX` (`Number`)                                     |
| `runtimeState.gatewayBaseUrl`            | `string`            | Internal gateway base URL used for worker runtime-state reads.        | None    | `MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL`                                                             |
| `controlPlaneApi.baseUrl`                | `string`            | Required internal control-plane API base URL used by worker flows.    | None    | `MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL`                                                              |
| `internalAuth.serviceToken`              | `string`            | Internal service token used by worker service-to-service calls.       | None    | Projected from global config                                                                                  |
| `telemetry`                              | `object`            | Worker telemetry config.                                              | None    | Projected from global config                                                                                  |
| `sandbox.storage.backend`                | `string` (optional) | Optional persistent sandbox storage backend selected for workers.     | None    | Projected from global config                                                                                  |
| `sandbox.internalGatewayWsUrl`           | `string`            | Internal gateway websocket URL used by sandbox bootstraps.            | None    | Projected from global config                                                                                  |
| `sandbox.bootstrap`                      | `object`            | Sandbox bootstrap token signing config.                               | None    | Projected from global config                                                                                  |
| `sandbox.docker.enabled`                 | `boolean`           | Whether Docker sandbox runtime config is available to the worker.     | None    | `MISTLE_SANDBOX_DOCKER_ENABLED`                                                                               |
| `sandbox.docker.socketPath`              | `string`            | Docker daemon socket path used when provider is docker.               | None    | `MISTLE_SANDBOX_DOCKER_SOCKET_PATH`                                                                           |
| `sandbox.docker.networkName`             | `string` (optional) | Optional Docker network name that sandbox containers join.            | None    | `MISTLE_SANDBOX_DOCKER_NETWORK_NAME`                                                                          |
| `sandboxStorage.dockerVolume.namePrefix` | `string` (optional) | Optional prefix applied to new Docker volume names.                   | None    | `MISTLE_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX`                                                            |
| `sandboxStorage.archil.apiKey`           | `string`            | Managed Archil API key used for durable sandbox provisioning.         | None    | `MISTLE_SANDBOX_STORAGE_ARCHIL_API_KEY`                                                                       |
| `sandboxStorage.archil.region`           | `string`            | Deployment-wide Archil region used for managed disks.                 | None    | `MISTLE_SANDBOX_STORAGE_ARCHIL_REGION`                                                                        |
| `sandboxStorage.archil.namePrefix`       | `string` (optional) | Optional prefix applied to new Archil disk names.                     | None    | `MISTLE_SANDBOX_STORAGE_ARCHIL_NAME_PREFIX`                                                                   |
| `sandboxStorage.archil.mounts`           | `0..1` entries      | Optional managed Archil mount definition for created disks.           | None    | Projected from `MISTLE_SANDBOX_STORAGE_ARCHIL_MOUNT_OBJECT_STORE` and `MISTLE_OBJECT_STORE_SANDBOX_STORAGE_*` |

Notes:

- Runtime provider selection is supplied by the sandbox profile version; worker config only exposes
  enabled provider credentials/config for providers the worker can execute.
- Managed deployments should set `workflow.runMigrations` to `false` and run OpenWorkflow migrations separately.
- `sandbox` carries the runtime sandbox dependencies the worker consumes.
- `sandboxStorage.dockerVolume` is only used when `sandbox.storage.backend = "docker_volume"`.
- `sandbox.sandboxdTestFaultsEnabled` is intended only for non-release/test environments where sandboxd fault injection must be enabled explicitly.
- `sandboxStorage.archil.mounts` currently supports only `s3-compatible` and must contain at most one entry.
- Archil-backed development and test configs should use a real remote
  S3-compatible bucket. Do not assume a local SeaweedFS endpoint is a
  supported Archil backing store.
