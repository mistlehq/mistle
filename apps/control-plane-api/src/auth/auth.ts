import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { ControlPlaneDbSchema } from "@mistle/db/control-plane";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import type { OpenWorkflow } from "openworkflow";

import { AUTH_ROUTE_BASE_PATH } from "./constants.js";
import { createAuthProviders } from "./providers/index.js";
import { applyActiveOrganizationToSession } from "./services/apply-active-organization-to-session.js";
import { createInitialOrganizationCredentialKey } from "./services/create-initial-organization-credential-key.js";
import { createSendOrganizationInvitationService } from "./services/create-send-organization-invitation.js";
import { createSendVerificationOTPService } from "./services/create-send-verification-otp.js";

export type ControlPlaneAuthConfig = {
  authBaseUrl: string;
  dashboardBaseUrl: string;
  authSecret: string;
  authTrustedOrigins: string[];
  authOTPLength: number;
  authOTPExpiresInSeconds: number;
  authOTPAllowedAttempts: number;
  authGoogleClientId: string | null;
  authGoogleClientSecret: string | null;
  activeMasterEncryptionKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
};

type CreateControlPlaneAuthOptions = {
  config: ControlPlaneAuthConfig;
  db: ControlPlaneDatabase;
  openWorkflow: OpenWorkflow;
};

export function createAccountOptions(): NonNullable<Parameters<typeof betterAuth>[0]["account"]> {
  return {
    modelName: "accounts",
    accountLinking: {
      enabled: true,
    },
  };
}

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
  const googleConfig =
    config.authGoogleClientId === null || config.authGoogleClientSecret === null
      ? null
      : {
          clientId: config.authGoogleClientId,
          clientSecret: config.authGoogleClientSecret,
        };
  const providers = createAuthProviders({
    config: {
      emailOtp: {
        otpLength: config.authOTPLength,
        otpExpiresInSeconds: config.authOTPExpiresInSeconds,
        otpAllowedAttempts: config.authOTPAllowedAttempts,
      },
      google: googleConfig,
    },
    sendVerificationOTP,
  });

  const auth = betterAuth({
    advanced: {
      database: {
        generateId: false,
      },
    },
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
    account: createAccountOptions(),
    verification: {
      modelName: "verifications",
    },
    socialProviders: providers.options.socialProviders,
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
      ...providers.options.plugins,
    ],
  });

  return auth;
}

export type ControlPlaneAuth = ReturnType<typeof createControlPlaneAuth>;
