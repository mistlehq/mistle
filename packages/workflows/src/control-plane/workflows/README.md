# Control-Plane Workflow Library

Reference catalog of control-plane workflows in `@mistle/workflows`.

## Workflows

| Workflow                       | Spec Export                                 | Workflow Name                                            | Input                                                                                                                                                                                                       | Output                                                                            | Purpose                                                                                                          |
| ------------------------------ | ------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Handle Automation Run          | `HandleAutomationRunWorkflowSpec`           | `control-plane.automations.handle-run`                   | `{ automationRunId: string }`                                                                                                                                                                               | `{ automationRunId: string }`                                                     | Handles a queued automation run through worker-provided automation run services.                                 |
| Handle Integration Webhook     | `HandleIntegrationWebhookEventWorkflowSpec` | `control-plane.integration-webhooks.handle-event`        | `{ webhookEventId: string }`                                                                                                                                                                                | `{ webhookEventId: string }`                                                      | Handles accepted webhook events through worker-provided integration webhook services.                            |
| Send Organization Invitation   | `SendOrganizationInvitationWorkflowSpec`    | `control-plane.auth.send-organization-invitation`        | `{ email: string; organizationName: string; inviterDisplayName: string; role: string; invitationUrl: string }`                                                                                              | `{ messageId: string }`                                                           | Sends organization invitation emails through SMTP.                                                               |
| Send Verification OTP          | `SendVerificationOTPWorkflowSpec`           | `control-plane.auth.send-verification-otp`               | `{ email: string; otp: string; type: "sign-in" \| "email-verification" \| "forget-password"; expiresInSeconds: number }`                                                                                    | `{ messageId: string }`                                                           | Sends the OTP email through `@mistle/emails` over SMTP.                                                          |
| Request Delete Sandbox Profile | `RequestDeleteSandboxProfileWorkflowSpec`   | `control-plane.sandbox-profiles.request-delete-profile`  | `{ organizationId: string; profileId: string }`                                                                                                                                                             | `{ profileId: string }`                                                           | Deletes a sandbox profile in background worker context.                                                          |
| Start Sandbox Profile Instance | `StartSandboxProfileInstanceWorkflowSpec`   | `control-plane.sandbox-instances.start-profile-instance` | `{ organizationId: string; sandboxProfileId: string; sandboxProfileVersion: number; startedBy: { kind: string; id: string }; source: string; image: { imageId: string; kind: string; createdAt: string } }` | `{ workflowRunId: string; sandboxInstanceId: string; providerSandboxId: string }` | Starts a sandbox via the configured sandbox instances service with caller-resolved image and runtime plan input. |

## Worker Services

`createControlPlaneWorker(...)` currently requires:

- `enabledWorkflows` with workflow ids from `ControlPlaneWorkerWorkflowIds`
- `services.automationRuns`:
  - `transitionAutomationRunToRunning`
  - `prepareAutomationRun`
  - `markAutomationRunCompleted`
  - `markAutomationRunFailed`
  - `resolveAutomationRunFailure`
- `services.integrationWebhooks`:
  - `handleWebhookEvent`
- `services.emailDelivery`:
  - `emailSender`
  - `from`
- `services.sandboxProfiles`:
  - `deleteSandboxProfile`
- `services.sandboxInstances`:
  - `startSandboxProfileInstance`

When adding a new workflow, update this file with the new workflow contract and runtime dependencies.
