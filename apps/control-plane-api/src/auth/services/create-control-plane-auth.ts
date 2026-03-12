import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { ControlPlaneDbSchema } from "@mistle/db/control-plane";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import type { createControlPlaneOpenWorkflow } from "../../openworkflow/index.js";
import { AUTH_ROUTE_BASE_PATH } from "../constants.js";
import { applyActiveOrganizationToSession } from "./apply-active-organization-to-session.js";
import { createInitialOrganizationCredentialKey } from "./create-initial-organization-credential-key.js";
import { createSendOrganizationInvitationService } from "./create-send-organization-invitation.js";
import { createSendVerificationOTPService } from "./create-send-verification-otp.js";

export type ControlPlaneAuthConfig = {
  authBaseUrl: string;
  dashboardBaseUrl: string;
  authSecret: string;
  authTrustedOrigins: string[];
  authOTPLength: number;
  authOTPExpiresInSeconds: number;
  authOTPAllowedAttempts: number;
  activeMasterEncryptionKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
};

type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;

type CreateControlPlaneAuthOptions = {
  config: ControlPlaneAuthConfig;
  db: ControlPlaneDatabase;
  openWorkflow: ControlPlaneOpenWorkflow;
};

export function createControlPlaneAuth(options: CreateControlPlaneAuthOptions) {
  const { config, db, openWorkflow } = options;
  const sendVerificationOTP = createSendVerificationOTPService({
    openWorkflow,
    expiresInSeconds: config.authOTPExpiresInSeconds,
  });
  const sendOrganizationInvitation = createSendOrganizationInvitationService({
    openWorkflow,
    dashboardBaseUrl: config.dashboardBaseUrl,
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
            inviterEmail: invitation.inviter.user.email,
            role: invitation.role,
          });
        },
        organizationHooks: {
          afterCreateOrganization: async ({ organization }) => {
            try {
              await createInitialOrganizationCredentialKey({
                db,
                organizationId: organization.id,
                activeMasterEncryptionKeyVersion: config.activeMasterEncryptionKeyVersion,
                masterEncryptionKeys: config.masterEncryptionKeys,
              });
            } catch (error) {
              await db
                .delete(ControlPlaneDbSchema.organizations)
                .where(eq(ControlPlaneDbSchema.organizations.id, organization.id));
              throw new Error(
                `Failed to initialize credential key for organization '${organization.id}'.`,
                { cause: error },
              );
            }
          },
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
            modelName: "teamMembers",
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

export type ControlPlaneAuth = ReturnType<typeof createControlPlaneAuth>;
