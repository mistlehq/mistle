import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { createControlPlaneOpenWorkflow } from "@mistle/workflows/control-plane";

import { ControlPlaneDbSchema } from "@mistle/db/control-plane";
import { SMTPEmailSender } from "@mistle/emails";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, organization } from "better-auth/plugins";

import { AUTH_ROUTE_BASE_PATH } from "../constants.js";
import { applyActiveOrganizationToSession } from "./apply-active-organization-to-session.js";
import { bootstrapUserOrganization } from "./bootstrap-user-organization.js";
import { createSendOrganizationInvitationService } from "./create-send-organization-invitation.js";
import { createSendVerificationOTPService } from "./create-send-verification-otp.js";
import { buildOrganizationName } from "./organization.js";

export type ControlPlaneAuthConfig = {
  authBaseUrl: string;
  authInvitationAcceptBaseUrl: string;
  authSecret: string;
  authTrustedOrigins: string[];
  authOTPLength: number;
  authOTPExpiresInSeconds: number;
  authOTPAllowedAttempts: number;
  emailFromAddress: string;
  emailFromName: string;
  emailSMTPHost: string;
  emailSMTPPort: number;
  emailSMTPSecure: boolean;
  emailSMTPUsername: string;
  emailSMTPPassword: string;
};

type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;

type CreateControlPlaneAuthOptions = {
  config: ControlPlaneAuthConfig;
  db: ControlPlaneDatabase;
  openWorkflow: ControlPlaneOpenWorkflow;
};

export type ControlPlaneAuth = ReturnType<typeof betterAuth>;

export function createControlPlaneAuth(options: CreateControlPlaneAuthOptions): ControlPlaneAuth {
  const { config, db, openWorkflow } = options;
  const emailSender = SMTPEmailSender.fromTransportOptions({
    host: config.emailSMTPHost,
    port: config.emailSMTPPort,
    secure: config.emailSMTPSecure,
    auth: {
      user: config.emailSMTPUsername,
      pass: config.emailSMTPPassword,
    },
  });
  const sendVerificationOTP = createSendVerificationOTPService({
    openWorkflow,
    expiresInSeconds: config.authOTPExpiresInSeconds,
  });
  const sendOrganizationInvitation = createSendOrganizationInvitationService({
    emailSender,
    fromAddress: config.emailFromAddress,
    fromName: config.emailFromName,
    invitationAcceptBaseUrl: config.authInvitationAcceptBaseUrl,
  });

  return betterAuth({
    baseURL: config.authBaseUrl,
    basePath: AUTH_ROUTE_BASE_PATH,
    secret: config.authSecret,
    trustedOrigins: config.authTrustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: ControlPlaneDbSchema,
    }),
    user: {
      modelName: "users",
    },
    session: {
      modelName: "sessions",
    },
    account: {
      modelName: "accounts",
    },
    verification: {
      modelName: "verifications",
    },
    databaseHooks: {
      user: {
        create: {
          async after(user) {
            await bootstrapUserOrganization({
              db,
              userId: user.id,
              name: buildOrganizationName(user.name),
            });
          },
        },
      },
      session: {
        create: {
          async before(session) {
            return applyActiveOrganizationToSession({
              db,
              session,
            });
          },
        },
      },
    },
    plugins: [
      organization({
        sendInvitationEmail: async (invitation) => {
          const inviterName = invitation.inviter.user.name;
          const inviterDisplayName =
            typeof inviterName === "string" && inviterName.trim().length > 0
              ? inviterName
              : invitation.inviter.user.email;

          await sendOrganizationInvitation({
            email: invitation.email,
            invitationId: invitation.id,
            organizationName: invitation.organization.name,
            inviterDisplayName,
            role: invitation.role,
          });
        },
        teams: {
          enabled: true,
          defaultTeam: {
            enabled: true,
          },
        },
        schema: {
          organization: {
            modelName: "organizations",
          },
          member: {
            modelName: "members",
          },
          invitation: {
            modelName: "invitations",
          },
          team: {
            modelName: "teams",
          },
          teamMember: {
            modelName: "team_members",
          },
        },
      }),
      emailOTP({
        otpLength: config.authOTPLength,
        expiresIn: config.authOTPExpiresInSeconds,
        allowedAttempts: config.authOTPAllowedAttempts,
        sendVerificationOTP,
      }),
    ],
  });
}
