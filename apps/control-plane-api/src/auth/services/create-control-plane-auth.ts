import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { EmailSender } from "@mistle/emails";

import { ControlPlaneDbSchema } from "@mistle/db/control-plane";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, organization } from "better-auth/plugins";

import { AUTH_ROUTE_BASE_PATH } from "../constants.js";
import { applyActiveOrganizationToSession } from "./apply-active-organization-to-session.js";
import { bootstrapUserOrganization } from "./bootstrap-user-organization.js";
import { createSendVerificationOTPService } from "./create-send-verification-otp.js";
import { buildOrganizationName } from "./organization.js";

export type ControlPlaneAuthConfig = {
  authBaseUrl: string;
  authSecret: string;
  authTrustedOrigins: string[];
  authOTPLength: number;
  authOTPExpiresInSeconds: number;
  authOTPAllowedAttempts: number;
  emailFromAddress: string;
  emailFromName: string;
};

type CreateControlPlaneAuthOptions = {
  config: ControlPlaneAuthConfig;
  db: ControlPlaneDatabase;
  emailSender: EmailSender;
};

export type ControlPlaneAuth = ReturnType<typeof betterAuth>;

export function createControlPlaneAuth(options: CreateControlPlaneAuthOptions): ControlPlaneAuth {
  const { config, db, emailSender } = options;
  const sendVerificationOTP = createSendVerificationOTPService({
    emailSender,
    from: {
      email: config.emailFromAddress,
      name: config.emailFromName,
    },
    expiresInSeconds: config.authOTPExpiresInSeconds,
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
