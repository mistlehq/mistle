# Control-Plane Workflow Library

Reference catalog of control-plane workflows in `@mistle/workflows`.

## Workflows

| Workflow                       | Spec Export                               | Workflow Name                                            | Input                                                                                                                                                                                                                         | Output                                                                            | Purpose                                                                                                      |
| ------------------------------ | ----------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Send Organization Invitation   | `SendOrganizationInvitationWorkflowSpec`  | `control-plane.auth.send-organization-invitation`        | `{ email: string; organizationName: string; inviterDisplayName: string; role: string; invitationUrl: string }`                                                                                                                | `{ messageId: string }`                                                           | Sends organization invitation emails through SMTP.                                                           |
| Send Verification OTP          | `SendVerificationOTPWorkflowSpec`         | `control-plane.auth.send-verification-otp`               | `{ email: string; otp: string; type: "sign-in" \| "email-verification" \| "forget-password"; expiresInSeconds: number }`                                                                                                      | `{ messageId: string }`                                                           | Sends the OTP email through `@mistle/emails` over SMTP.                                                      |
| Request Delete Sandbox Profile | `RequestDeleteSandboxProfileWorkflowSpec` | `control-plane.sandbox-profiles.request-delete-profile`  | `{ organizationId: string; profileId: string }`                                                                                                                                                                               | `{ profileId: string }`                                                           | Deletes a sandbox profile in background worker context.                                                      |
| Start Sandbox Profile Instance | `StartSandboxProfileInstanceWorkflowSpec` | `control-plane.sandbox-instances.start-profile-instance` | `{ organizationId: string; sandboxProfileId: string; sandboxProfileVersion: number; startedBy: { kind: string; id: string }; source: string; image: { provider: string; imageId: string; kind: string; createdAt: string } }` | `{ workflowRunId: string; sandboxInstanceId: string; providerSandboxId: string }` | Resolves profile-version manifest and starts a sandbox via data-plane API using caller-resolved image input. |

## Registration Dependencies

`createControlPlaneWorkflowDefinitions(...)` currently requires:

- `sendOrganizationInvitation.emailSender`
- `sendOrganizationInvitation.from`
- `sendVerificationOTP.emailSender`
- `sendVerificationOTP.from`
- `requestDeleteSandboxProfile.deleteSandboxProfile`
- `startSandboxProfileInstance.resolveSandboxProfileVersion`
- `startSandboxProfileInstance.startSandboxInstance`

When adding a new workflow, update this file with the new workflow contract and runtime dependencies.
