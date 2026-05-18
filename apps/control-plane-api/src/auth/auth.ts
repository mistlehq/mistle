import type { ControlPlaneDatabase, ControlPlaneTables } from "@mistle/db/control-plane";
import { ControlPlaneDbSchema, UserAppearances } from "@mistle/db/control-plane";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import type { OpenWorkflow } from "openworkflow";
import { z } from "zod";

import { enqueueStripeCustomerProvisioning } from "../organizations/services/organization-billing.js";
import { AUTH_ROUTE_BASE_PATH } from "./constants.js";
import { createAuthProviders } from "./providers/index.js";
import type { GoogleProviderConfig } from "./providers/types.js";
import { applyActiveOrganizationToSession } from "./services/apply-active-organization-to-session.js";
import { createInitialOrganizationCredentialKey } from "./services/create-initial-organization-credential-key.js";
import { createSendOrganizationInvitationService } from "./services/create-send-organization-invitation.js";
import { createSendVerificationOTPService } from "./services/create-send-verification-otp.js";

export type ControlPlaneAuthConfig = {
  authBaseUrl: string;
  dashboardBaseUrl: string;
  authSecret: string;
  authTrustedOrigins: string[];
  authAllowSignups: boolean;
  authOTPLength: number;
  authOTPExpiresInSeconds: number;
  authOTPAllowedAttempts: number;
  authGoogleClientId: string | null;
  authGoogleClientSecret: string | null;
  authGoogleProviderOverrides?: Omit<GoogleProviderConfig, "clientId" | "clientSecret">;
  activeMasterEncryptionKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
  billing: {
    stripe: {
      enabled: boolean;
    };
  };
};

type CreateControlPlaneAuthOptions = {
  config: ControlPlaneAuthConfig;
  db: ControlPlaneDatabase;
  tables?: ControlPlaneTables;
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
  const tables = options.tables ?? ControlPlaneDbSchema;
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
          ...(config.authGoogleProviderOverrides === undefined
            ? {}
            : config.authGoogleProviderOverrides),
        };
  const providers = createAuthProviders({
    config: {
      emailOtp: {
        otpLength: config.authOTPLength,
        otpExpiresInSeconds: config.authOTPExpiresInSeconds,
        otpAllowedAttempts: config.authOTPAllowedAttempts,
        allowSignups: config.authAllowSignups,
      },
      google:
        googleConfig === null ? null : { ...googleConfig, allowSignups: config.authAllowSignups },
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
      schema: tables,
    }),
    user: {
      modelName: "users",
      additionalFields: {
        appearance: {
          type: "string",
          fieldName: "appearance",
          required: false,
          input: true,
          returned: true,
          defaultValue: UserAppearances.SYSTEM,
          validator: {
            input: z.enum([UserAppearances.SYSTEM, UserAppearances.LIGHT, UserAppearances.DARK]),
            output: z.enum([UserAppearances.SYSTEM, UserAppearances.LIGHT, UserAppearances.DARK]),
          },
        },
      },
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
      user: {
        create: {
          async before() {
            if (config.authAllowSignups) {
              return;
            }

            throw new APIError("FORBIDDEN", {
              code: "SIGNUPS_DISABLED",
              message: "Signups are disabled.",
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
                table: tables.organizationCredentialKeys,
              });
              if (config.billing.stripe.enabled) {
                await enqueueStripeCustomerProvisioning({
                  db,
                  table: tables.organizationBillingCustomers,
                  openWorkflow,
                  organizationId: organization.id,
                  organizationName: organization.name,
                });
              }
            } catch (error) {
              await db
                .delete(tables.organizations)
                .where(eq(tables.organizations.id, organization.id));
              throw new Error(`Failed to initialize organization '${organization.id}'.`, {
                cause: error,
              });
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
