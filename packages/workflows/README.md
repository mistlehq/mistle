# @mistle/workflows

Shared OpenWorkflow definitions and wiring for control-plane and data-plane.
Both plane modules are thin wrappers over shared scaffolding in `src/core/`.

## Public API

Import using subpath entrypoints:

- `@mistle/workflows/control-plane`
- `@mistle/workflows/data-plane`

Root export is also available:

- `@mistle/workflows` (namespaced re-exports as `ControlPlaneWorkflows` and `DataPlaneWorkflows`)

## Workflow Libraries

- [Control-plane workflow library](./src/control-plane/workflows/README.md)
- [Data-plane workflow library](./src/data-plane/workflows/README.md)

### `@mistle/workflows/control-plane`

| Export                                      | Type            | Purpose                                                                                                |
| ------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `ControlPlaneOpenWorkflow.SCHEMA`           | `string`        | Dedicated OpenWorkflow schema name (`control_plane_openworkflow`).                                     |
| `createControlPlaneBackend`                 | `function`      | Creates a Postgres backend configured to the control-plane schema.                                     |
| `createControlPlaneOpenWorkflow`            | `function`      | Creates an OpenWorkflow client for producers and workers.                                              |
| `createControlPlaneWorker`                  | `function`      | Registers control-plane workflows and returns a worker instance.                                       |
| `ControlPlaneWorkerWorkflowIds`             | `const`         | Workflow id constants used by `createControlPlaneWorker` for explicit workflow registration selection. |
| `SendOrganizationInvitationWorkflowSpec`    | `workflow spec` | Spec for invitation email delivery workflow (`control-plane.auth.send-organization-invitation`).       |
| `SendVerificationOTPWorkflowSpec`           | `workflow spec` | Spec for OTP email delivery workflow (`control-plane.auth.send-verification-otp`).                     |
| `RequestDeleteSandboxProfileWorkflowSpec`   | `workflow spec` | Spec for sandbox profile deletion workflow (`control-plane.sandbox-profiles.request-delete-profile`).  |
| `createSendOrganizationInvitationWorkflow`  | `function`      | Creates the invitation email workflow implementation with injected email dependencies.                 |
| `createSendVerificationOTPWorkflow`         | `function`      | Creates the OTP workflow implementation with injected email dependencies.                              |
| `createRequestDeleteSandboxProfileWorkflow` | `function`      | Creates the sandbox profile deletion workflow implementation.                                          |

### `@mistle/workflows/data-plane`

| Export                             | Type            | Purpose                                                                              |
| ---------------------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `DataPlaneOpenWorkflow.SCHEMA`     | `string`        | Dedicated OpenWorkflow schema name (`data_plane_openworkflow`).                      |
| `createDataPlaneBackend`           | `function`      | Creates a Postgres backend configured to the data-plane schema.                      |
| `createDataPlaneOpenWorkflow`      | `function`      | Creates an OpenWorkflow client for producers and workers.                            |
| `createDataPlaneWorker`            | `function`      | Registers data-plane workflows and returns a worker instance.                        |
| `DataPlaneWorkerWorkflowIds`       | `const`         | Workflow id constants used by `createDataPlaneWorker` for explicit registration.     |
| `StartSandboxInstanceWorkflowSpec` | `workflow spec` | Spec for data-plane sandbox instance startup (`data-plane.sandbox-instances.start`). |

## Example Usage

### Control-plane worker bootstrap

```ts
import {
  ControlPlaneWorkerWorkflowIds,
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
  createControlPlaneWorker,
} from "@mistle/workflows/control-plane";
import { SMTPEmailSender } from "@mistle/emails";
const backend = await createControlPlaneBackend({
  url: process.env.CONTROL_PLANE_DATABASE_URL!,
  namespaceId: "production",
  runMigrations: true,
});

const ow = createControlPlaneOpenWorkflow({ backend });
const emailSender = SMTPEmailSender.fromTransportOptions({
  host: "smtp.local",
  port: 1025,
  secure: false,
  auth: {
    user: "mailpit",
    pass: "mailpit",
  },
});

const worker = createControlPlaneWorker({
  openWorkflow: ow,
  maxConcurrentWorkflows: 4,
  enabledWorkflows: [
    ControlPlaneWorkerWorkflowIds.SEND_ORGANIZATION_INVITATION,
    ControlPlaneWorkerWorkflowIds.SEND_VERIFICATION_OTP,
    ControlPlaneWorkerWorkflowIds.REQUEST_DELETE_SANDBOX_PROFILE,
  ],
  services: {
    emailDelivery: {
      emailSender,
      from: {
        email: "noreply@example.com",
        name: "Mistle",
      },
    },
    sandboxProfiles: {
      deleteSandboxProfile: async () => {},
    },
  },
});

await worker.start();
```

### Control-plane producer usage

```ts
import {
  createControlPlaneOpenWorkflow,
  RequestDeleteSandboxProfileWorkflowSpec,
  SendOrganizationInvitationWorkflowSpec,
  SendVerificationOTPWorkflowSpec,
} from "@mistle/workflows/control-plane";

const ow = createControlPlaneOpenWorkflow({ backend });

await ow.runWorkflow(SendVerificationOTPWorkflowSpec, {
  email: "user@example.com",
  otp: "123456",
  type: "sign-in",
  expiresInSeconds: 300,
});

await ow.runWorkflow(SendOrganizationInvitationWorkflowSpec, {
  email: "user@example.com",
  organizationName: "Acme",
  inviterDisplayName: "Owner",
  role: "member",
  invitationUrl: "https://app.example/invitations/accept?invitationId=inv_123",
});

await ow.runWorkflow(RequestDeleteSandboxProfileWorkflowSpec, {
  organizationId: "org_123",
  profileId: "sbp_123",
});
```

### Data-plane worker bootstrap

```ts
import {
  DataPlaneWorkerWorkflowIds,
  createDataPlaneBackend,
  createDataPlaneOpenWorkflow,
  createDataPlaneWorker,
} from "@mistle/workflows/data-plane";
import { Pool } from "pg";

const dbPool = new Pool({
  connectionString: process.env.DATA_PLANE_DATABASE_URL!,
});

const backend = await createDataPlaneBackend({
  url: process.env.DATA_PLANE_DATABASE_URL!,
  namespaceId: "production",
  runMigrations: true,
});

const ow = createDataPlaneOpenWorkflow({ backend });

const worker = createDataPlaneWorker({
  openWorkflow: ow,
  maxConcurrentWorkflows: 4,
  enabledWorkflows: [DataPlaneWorkerWorkflowIds.START_SANDBOX_INSTANCE],
  services: {
    startSandboxInstance: {
      sandboxLifecycle: {
        startSandbox: async () => ({
          provider: "modal",
          providerSandboxId: "sb_123",
          bootstrapTokenJti: "jti_123",
        }),
        stopSandbox: async () => {},
      },
      sandboxInstances: {
        createSandboxInstance: async () => ({ sandboxInstanceId: "sbi_123" }),
        markSandboxInstanceRunning: async () => {},
        markSandboxInstanceFailed: async () => {},
      },
      tunnelConnectAcks: {
        waitForSandboxTunnelConnectAck: async () => true,
      },
    },
  },
});

await worker.start();
```

## Add A New Workflow

1. Create a workflow module under the target plane directory, for example `src/control-plane/workflows/send-verification-otp/`.
2. Define the workflow spec in `spec.ts` and implementation in `workflow.ts`.
3. Export it through `src/control-plane/workflows/index.ts` or `src/data-plane/workflows/index.ts`.
4. Add worker service contracts to the plane worker factory so runtime wiring stays in one place.
5. Export the workflow spec from the plane entrypoint (`src/control-plane/index.ts` or `src/data-plane/index.ts`) if producers in apps need to schedule it.
6. Use the plane client in producers and call `runWorkflow(workflowSpec, input)`.

Example worker wiring:

```ts
// src/control-plane/worker.ts
import {
  ControlPlaneWorkerWorkflowIds,
  createControlPlaneWorker as createWorker,
} from "./control-plane/worker.js";

export function createRuntimeControlPlaneWorker(input) {
  return createWorker({
    openWorkflow: input.openWorkflow,
    maxConcurrentWorkflows: input.maxConcurrentWorkflows,
    enabledWorkflows: [
      ControlPlaneWorkerWorkflowIds.SEND_ORGANIZATION_INVITATION,
      ControlPlaneWorkerWorkflowIds.SEND_VERIFICATION_OTP,
    ],
    services: {
      emailDelivery: {
        emailSender: input.emailSender,
        from: input.emailFrom,
      },
      sandboxProfiles: {
        deleteSandboxProfile: input.deleteSandboxProfile,
      },
    },
  });
}
```

## Notes

- Each plane uses a separate schema by default to avoid migration conflicts.
- `src/core/*` is internal scaffolding shared by both planes; apps should import from plane entrypoints, not `src/core`.
