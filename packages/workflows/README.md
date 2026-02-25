# @mistle/workflows

Shared OpenWorkflow definitions and wiring for control-plane and data-plane.
Both plane modules are thin wrappers over shared scaffolding in `src/core/`.

## Public API

Import using subpath entrypoints:

- `@mistle/workflows/control-plane`
- `@mistle/workflows/data-plane`

Root export is also available:

- `@mistle/workflows` (namespaced re-exports as `ControlPlaneWorkflows` and `DataPlaneWorkflows`)

### `@mistle/workflows/control-plane`

| Export                            | Type             | Purpose                                                                 |
| --------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `ControlPlaneOpenWorkflow.SCHEMA` | `string`         | Dedicated OpenWorkflow schema name (`control_plane_openworkflow`).      |
| `createControlPlaneBackend`       | `function`       | Creates a Postgres backend configured to the control-plane schema.      |
| `createControlPlaneOpenWorkflow`  | `function`       | Creates an OpenWorkflow client for producers and workers.               |
| `createControlPlaneWorker`        | `function`       | Registers control-plane workflows and returns a worker instance.        |
| `registerControlPlaneWorkflows`   | `function`       | Registers control-plane workflows on an existing OpenWorkflow instance. |
| `controlPlaneWorkflowDefinitions` | `readonly array` | Registry source for workflow implementations in this plane.             |

### `@mistle/workflows/data-plane`

| Export                         | Type             | Purpose                                                              |
| ------------------------------ | ---------------- | -------------------------------------------------------------------- |
| `DataPlaneOpenWorkflow.SCHEMA` | `string`         | Dedicated OpenWorkflow schema name (`data_plane_openworkflow`).      |
| `createDataPlaneBackend`       | `function`       | Creates a Postgres backend configured to the data-plane schema.      |
| `createDataPlaneOpenWorkflow`  | `function`       | Creates an OpenWorkflow client for producers and workers.            |
| `createDataPlaneWorker`        | `function`       | Registers data-plane workflows and returns a worker instance.        |
| `registerDataPlaneWorkflows`   | `function`       | Registers data-plane workflows on an existing OpenWorkflow instance. |
| `dataPlaneWorkflowDefinitions` | `readonly array` | Registry source for workflow implementations in this plane.          |

## Example Usage

### Control-plane worker bootstrap

```ts
import {
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
  createControlPlaneWorker,
} from "@mistle/workflows/control-plane";

const backend = await createControlPlaneBackend({
  url: process.env.CONTROL_PLANE_DATABASE_URL!,
  namespaceId: "production",
  runMigrations: true,
});

const ow = createControlPlaneOpenWorkflow({ backend });

const worker = createControlPlaneWorker({
  openWorkflow: ow,
  concurrency: 4,
});

await worker.start();
```

### Control-plane producer usage

```ts
import { createControlPlaneOpenWorkflow } from "@mistle/workflows/control-plane";

const ow = createControlPlaneOpenWorkflow({ backend });

// `sendOtpWorkflowSpec` is a workflow spec exported from this package after you add it.
await ow.runWorkflow(sendOtpWorkflowSpec, {
  userId: "usr_123",
});
```

### Data-plane worker bootstrap

```ts
import {
  createDataPlaneBackend,
  createDataPlaneOpenWorkflow,
  createDataPlaneWorker,
} from "@mistle/workflows/data-plane";

const backend = await createDataPlaneBackend({
  url: process.env.DATA_PLANE_DATABASE_URL!,
  namespaceId: "production",
  runMigrations: true,
});

const ow = createDataPlaneOpenWorkflow({ backend });

const worker = createDataPlaneWorker({
  openWorkflow: ow,
  concurrency: 4,
});

await worker.start();
```

## Add A New Workflow

1. Create a workflow module under the target plane directory, for example `src/control-plane/workflows/send-otp.ts`.
2. Define the workflow using `defineWorkflow(...)` from `openworkflow`.
3. Import it in the plane registry file and include it in the array:
   `src/control-plane/workflows/index.ts` or `src/data-plane/workflows/index.ts`.
4. Export the workflow spec from the plane entrypoint (`src/control-plane/index.ts` or `src/data-plane/index.ts`) if producers in apps need to schedule it.
5. Use the plane client in producers and call `runWorkflow(workflow.spec, input)`.

Example registry wiring:

```ts
// src/control-plane/workflows/index.ts
import { sendOtpWorkflow } from "./send-otp.js";

export const controlPlaneWorkflowDefinitions = [sendOtpWorkflow] as const;
```

## Notes

- Each plane uses a separate schema by default to avoid migration conflicts.
- `src/core/*` is internal scaffolding shared by both planes; apps should import from plane entrypoints, not `src/core`.
