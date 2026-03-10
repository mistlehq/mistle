# Data-Plane Workflow Library

Reference catalog of data-plane workflows in `@mistle/workflows`.

The data-plane package owns workflow orchestration. Runtime dependencies such as provider lifecycle operations and persistence adapters are supplied by the data-plane worker app.

## Workflows

| Workflow               | Spec Export                        | Workflow Name                        | Input                                                                                                                                                                                                                          | Output                                                     | Purpose                                                                                                                                      |
| ---------------------- | ---------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Start Sandbox Instance | `StartSandboxInstanceWorkflowSpec` | `data-plane.sandbox-instances.start` | `{ organizationId: string; sandboxProfileId: string; sandboxProfileVersion: number; startedBy: { kind: "user"; id: string }; source: "dashboard"; image: { imageId: string; kind: "base" \| "snapshot"; createdAt: string } }` | `{ sandboxInstanceId: string; providerSandboxId: string }` | Starts a provider sandbox, persists the data-plane `sandbox_instances` row, and rolls back provider sandbox creation when persistence fails. |

## Worker Services

`createDataPlaneWorker(...)` registers workflows through `src/data-plane/register/` and currently requires:

- `enabledWorkflows` with workflow ids from `DataPlaneWorkerWorkflowIds`
- `services.startSandboxInstance.sandboxLifecycle`
  - `startSandbox`
  - `stopSandbox`
- `services.startSandboxInstance.sandboxInstances`
  - `createSandboxInstance`
  - `markSandboxInstanceRunning`
  - `markSandboxInstanceFailed`
- `services.startSandboxInstance.tunnelConnectAcks`
  - `waitForSandboxTunnelConnectAck`
