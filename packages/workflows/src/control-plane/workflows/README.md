# Control-Plane Workflow Library

Reference catalog of control-plane workflows in `@mistle/workflows`.

## Workflows

| Workflow                       | Spec Export                               | Workflow Name                                           | Input                                                                                                                    | Output                  | Purpose                                                 |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------- |
| Send Verification OTP          | `SendVerificationOTPWorkflowSpec`         | `control-plane.auth.send-verification-otp`              | `{ email: string; otp: string; type: "sign-in" \| "email-verification" \| "forget-password"; expiresInSeconds: number }` | `{ messageId: string }` | Sends the OTP email through `@mistle/emails` over SMTP. |
| Request Delete Sandbox Profile | `RequestDeleteSandboxProfileWorkflowSpec` | `control-plane.sandbox-profiles.request-delete-profile` | `{ organizationId: string; profileId: string }`                                                                          | `{ profileId: string }` | Deletes a sandbox profile in background worker context. |

## Registration Dependencies

`createControlPlaneWorkflowDefinitions(...)` currently requires:

- `sendVerificationOTP.emailSender`
- `sendVerificationOTP.from`
- `requestDeleteSandboxProfile.deleteSandboxProfile`

When adding a new workflow, update this file with the new workflow contract and runtime dependencies.
