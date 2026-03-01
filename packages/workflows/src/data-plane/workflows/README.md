# Data-Plane Workflow Library

Reference catalog of data-plane workflows in `@mistle/workflows`.

## Workflows

| Workflow               | Spec Export                        | Workflow Name                        | Input                                                                                                                                                                                                                          | Output                                                     | Purpose                                                                                                                                      |
| ---------------------- | ---------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Start Sandbox Instance | `StartSandboxInstanceWorkflowSpec` | `data-plane.sandbox-instances.start` | `{ organizationId: string; sandboxProfileId: string; sandboxProfileVersion: number; startedBy: { kind: "user"; id: string }; source: "dashboard"; image: { imageId: string; kind: "base" \| "snapshot"; createdAt: string } }` | `{ sandboxInstanceId: string; providerSandboxId: string }` | Starts a provider sandbox, persists the data-plane `sandbox_instances` row, and rolls back provider sandbox creation when persistence fails. |

## Registration Dependencies

`createDataPlaneWorkflowDefinitions(...)` currently requires:

- `startSandboxInstance.startSandbox`
- `startSandboxInstance.stopSandbox`
- `startSandboxInstance.insertSandboxInstance`
