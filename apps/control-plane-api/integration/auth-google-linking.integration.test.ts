import { APIError } from "better-auth/api";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { describe, expect } from "vitest";

import { createControlPlaneAuth } from "../src/auth/index.js";
import { createControlPlaneBackend, createControlPlaneOpenWorkflow } from "../src/openworkflow.js";
import { readLatestSignInOtp } from "./helpers/sign-in-otp.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

type OAuthEndpointContext = Parameters<typeof handleOAuthUserInfo>[0];
type OAuthRedirectUrl = Parameters<OAuthEndpointContext["redirect"]>[0];
type OAuthErrorStatus = Parameters<OAuthEndpointContext["error"]>[0];
type OAuthErrorBody = Parameters<OAuthEndpointContext["error"]>[1];
type OAuthErrorHeaders = Parameters<OAuthEndpointContext["error"]>[2];
type ControlPlaneAuthContext = Awaited<ReturnType<typeof createControlPlaneAuth>["$context"]>;

async function sendOTPRequest(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  recipient: string;
}): Promise<Response> {
  return input.fixture.request("/v1/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input.recipient,
      type: "sign-in",
    }),
  });
}

async function signInWithOTP(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  recipient: string;
  otp: string;
}): Promise<Response> {
  return input.fixture.request("/v1/auth/sign-in/email-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input.recipient,
      otp: input.otp,
    }),
  });
}

async function readIssuedOtp(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  recipient: string;
}): Promise<string> {
  return readLatestSignInOtp({
    db: input.fixture.db,
    email: input.recipient,
    otpLength: input.fixture.config.auth.otpLength,
  });
}

async function jsonResponse<R extends Record<string, any> | null>(json: R): Promise<R> {
  return json;
}

function createOAuthEndpointContext(context: ControlPlaneAuthContext) {
  return {
    method: "GET",
    path: "/callback/google",
    body: undefined,
    query: {},
    params: {},
    request: new Request("http://localhost:3000/v1/auth/callback/google"),
    headers: new Headers(),
    setHeader() {},
    setStatus() {},
    getHeader() {
      return null;
    },
    getCookie() {
      return null;
    },
    async getSignedCookie() {
      return null;
    },
    setCookie() {
      return "";
    },
    async setSignedCookie() {
      return "";
    },
    json: jsonResponse,
    context,
    redirect(url: OAuthRedirectUrl) {
      return new APIError("FOUND", {
        message: url,
      });
    },
    error(status: OAuthErrorStatus, body?: OAuthErrorBody, headers?: OAuthErrorHeaders) {
      return new APIError(status, body, headers);
    },
  };
}

describe("auth google linking integration", () => {
  it("links google sign-in to an existing OTP user with the same email", async ({ fixture }) => {
    const email = "google-linking-existing-otp@example.com";

    const sendResponse = await sendOTPRequest({
      fixture,
      recipient: email,
    });
    expect(sendResponse.status).toBe(200);

    const otp = await readIssuedOtp({
      fixture,
      recipient: email,
    });
    const signInResponse = await signInWithOTP({
      fixture,
      recipient: email,
      otp,
    });
    expect(signInResponse.status).toBe(200);

    const existingUser = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
        email: true,
        emailVerified: true,
      },
      where: (users, { eq }) => eq(users.email, email),
    });
    expect(existingUser).toBeDefined();
    if (existingUser === undefined) {
      throw new Error("Expected OTP sign-in to create a user.");
    }
    expect(existingUser.emailVerified).toBe(true);

    const workflowBackend = await createControlPlaneBackend({
      url: fixture.databaseStack.directUrl,
      namespaceId: fixture.config.workflow.namespaceId,
      runMigrations: false,
    });
    const openWorkflow = createControlPlaneOpenWorkflow({
      backend: workflowBackend,
    });

    try {
      const auth = createControlPlaneAuth({
        config: {
          authBaseUrl: fixture.config.auth.baseUrl,
          dashboardBaseUrl: fixture.config.dashboard.baseUrl,
          authSecret: fixture.config.auth.secret,
          authTrustedOrigins: fixture.config.auth.trustedOrigins,
          authOTPLength: fixture.config.auth.otpLength,
          authOTPExpiresInSeconds: fixture.config.auth.otpExpiresInSeconds,
          authOTPAllowedAttempts: fixture.config.auth.otpAllowedAttempts,
          authGoogleClientId: "integration-google-client-id",
          authGoogleClientSecret: "integration-google-client-secret",
          activeMasterEncryptionKeyVersion:
            fixture.config.integrations.activeMasterEncryptionKeyVersion,
          masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
        },
        db: fixture.db,
        openWorkflow,
      });
      const endpointContext = createOAuthEndpointContext(await auth.$context);

      // Better Auth narrows AuthContext by options, but this runtime context provides
      // the shared fields handleOAuthUserInfo uses for real linking behavior.
      // @ts-expect-error External Better Auth type variance rejects narrower auth options here.
      const result = await handleOAuthUserInfo(endpointContext, {
        userInfo: {
          id: "google-user-id-1",
          email,
          emailVerified: true,
          name: "Google Linked User",
          image: "https://example.com/avatar.png",
        },
        account: {
          providerId: "google",
          accountId: "google-user-id-1",
          accessToken: "google-access-token",
          refreshToken: "google-refresh-token",
          idToken: "google-id-token",
          accessTokenExpiresAt: new Date("2026-03-31T01:00:00.000Z"),
          refreshTokenExpiresAt: new Date("2026-04-01T01:00:00.000Z"),
          scope: "openid email profile",
        },
        callbackURL: "http://localhost:5173/auth/login/callback?redirectTo=%2F",
      });

      expect(result.error).toBeNull();
      if (result.error !== null) {
        throw new Error(`Expected google sign-in linking to succeed, got '${result.error}'.`);
      }
      expect(result.isRegister).toBe(false);
      expect(result.data.user.id).toBe(existingUser.id);

      const users = await fixture.db.query.users.findMany({
        columns: {
          id: true,
          email: true,
        },
        where: (users, { eq }) => eq(users.email, email),
      });
      expect(users).toHaveLength(1);

      const linkedGoogleAccount = await fixture.db.query.accounts.findFirst({
        columns: {
          userId: true,
          providerId: true,
          accountId: true,
        },
        where: (accounts, { and, eq }) =>
          and(eq(accounts.providerId, "google"), eq(accounts.accountId, "google-user-id-1")),
      });
      expect(linkedGoogleAccount).toEqual({
        userId: existingUser.id,
        providerId: "google",
        accountId: "google-user-id-1",
      });
    } finally {
      await workflowBackend.stop();
    }
  });

  it("reuses the same user when an existing google-linked user signs in with OTP", async ({
    fixture,
  }) => {
    const email = "google-linking-existing-google@example.com";
    const workflowBackend = await createControlPlaneBackend({
      url: fixture.databaseStack.directUrl,
      namespaceId: fixture.config.workflow.namespaceId,
      runMigrations: false,
    });
    const openWorkflow = createControlPlaneOpenWorkflow({
      backend: workflowBackend,
    });

    try {
      const auth = createControlPlaneAuth({
        config: {
          authBaseUrl: fixture.config.auth.baseUrl,
          dashboardBaseUrl: fixture.config.dashboard.baseUrl,
          authSecret: fixture.config.auth.secret,
          authTrustedOrigins: fixture.config.auth.trustedOrigins,
          authOTPLength: fixture.config.auth.otpLength,
          authOTPExpiresInSeconds: fixture.config.auth.otpExpiresInSeconds,
          authOTPAllowedAttempts: fixture.config.auth.otpAllowedAttempts,
          authGoogleClientId: "integration-google-client-id",
          authGoogleClientSecret: "integration-google-client-secret",
          activeMasterEncryptionKeyVersion:
            fixture.config.integrations.activeMasterEncryptionKeyVersion,
          masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
        },
        db: fixture.db,
        openWorkflow,
      });
      const endpointContext = createOAuthEndpointContext(await auth.$context);

      // Better Auth narrows AuthContext by options, but this runtime context provides
      // the shared fields handleOAuthUserInfo uses for real linking behavior.
      // @ts-expect-error External Better Auth type variance rejects narrower auth options here.
      const googleResult = await handleOAuthUserInfo(endpointContext, {
        userInfo: {
          id: "google-user-id-2",
          email,
          emailVerified: true,
          name: "Google First User",
          image: "https://example.com/avatar-2.png",
        },
        account: {
          providerId: "google",
          accountId: "google-user-id-2",
          accessToken: "google-access-token-2",
          refreshToken: "google-refresh-token-2",
          idToken: "google-id-token-2",
          accessTokenExpiresAt: new Date("2026-03-31T02:00:00.000Z"),
          refreshTokenExpiresAt: new Date("2026-04-01T02:00:00.000Z"),
          scope: "openid email profile",
        },
        callbackURL: "http://localhost:5173/auth/login/callback?redirectTo=%2F",
      });

      expect(googleResult.error).toBeNull();
      if (googleResult.error !== null) {
        throw new Error(`Expected initial google sign-in to succeed, got '${googleResult.error}'.`);
      }
      expect(googleResult.isRegister).toBe(true);

      const existingUser = await fixture.db.query.users.findFirst({
        columns: {
          id: true,
          email: true,
          emailVerified: true,
        },
        where: (users, { eq }) => eq(users.email, email),
      });
      expect(existingUser).toBeDefined();
      if (existingUser === undefined) {
        throw new Error("Expected google sign-in to create a user.");
      }
      expect(existingUser.id).toBe(googleResult.data.user.id);
      expect(existingUser.emailVerified).toBe(true);

      const sendResponse = await sendOTPRequest({
        fixture,
        recipient: email,
      });
      expect(sendResponse.status).toBe(200);

      const otp = await readIssuedOtp({
        fixture,
        recipient: email,
      });
      const signInResponse = await signInWithOTP({
        fixture,
        recipient: email,
        otp,
      });
      expect(signInResponse.status).toBe(200);

      const users = await fixture.db.query.users.findMany({
        columns: {
          id: true,
          email: true,
        },
        where: (users, { eq }) => eq(users.email, email),
      });
      expect(users).toHaveLength(1);
      expect(users[0]?.id).toBe(existingUser.id);

      const linkedGoogleAccount = await fixture.db.query.accounts.findFirst({
        columns: {
          userId: true,
          providerId: true,
          accountId: true,
        },
        where: (accounts, { and, eq }) =>
          and(eq(accounts.providerId, "google"), eq(accounts.accountId, "google-user-id-2")),
      });
      expect(linkedGoogleAccount).toEqual({
        userId: existingUser.id,
        providerId: "google",
        accountId: "google-user-id-2",
      });
    } finally {
      await workflowBackend.stop();
    }
  });

  it("does not link an unverified google email to an existing OTP user", async ({ fixture }) => {
    const email = "google-linking-unverified@example.com";

    const sendResponse = await sendOTPRequest({
      fixture,
      recipient: email,
    });
    expect(sendResponse.status).toBe(200);

    const otp = await readIssuedOtp({
      fixture,
      recipient: email,
    });
    const signInResponse = await signInWithOTP({
      fixture,
      recipient: email,
      otp,
    });
    expect(signInResponse.status).toBe(200);

    const existingUser = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
        email: true,
        emailVerified: true,
      },
      where: (users, { eq }) => eq(users.email, email),
    });
    expect(existingUser).toBeDefined();
    if (existingUser === undefined) {
      throw new Error("Expected OTP sign-in to create a user.");
    }
    expect(existingUser.emailVerified).toBe(true);

    const workflowBackend = await createControlPlaneBackend({
      url: fixture.databaseStack.directUrl,
      namespaceId: fixture.config.workflow.namespaceId,
      runMigrations: false,
    });
    const openWorkflow = createControlPlaneOpenWorkflow({
      backend: workflowBackend,
    });

    try {
      const auth = createControlPlaneAuth({
        config: {
          authBaseUrl: fixture.config.auth.baseUrl,
          dashboardBaseUrl: fixture.config.dashboard.baseUrl,
          authSecret: fixture.config.auth.secret,
          authTrustedOrigins: fixture.config.auth.trustedOrigins,
          authOTPLength: fixture.config.auth.otpLength,
          authOTPExpiresInSeconds: fixture.config.auth.otpExpiresInSeconds,
          authOTPAllowedAttempts: fixture.config.auth.otpAllowedAttempts,
          authGoogleClientId: "integration-google-client-id",
          authGoogleClientSecret: "integration-google-client-secret",
          activeMasterEncryptionKeyVersion:
            fixture.config.integrations.activeMasterEncryptionKeyVersion,
          masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
        },
        db: fixture.db,
        openWorkflow,
      });
      const endpointContext = createOAuthEndpointContext(await auth.$context);

      // Better Auth narrows AuthContext by options, but this runtime context provides
      // the shared fields handleOAuthUserInfo uses for real linking behavior.
      // @ts-expect-error External Better Auth type variance rejects narrower auth options here.
      const result = await handleOAuthUserInfo(endpointContext, {
        userInfo: {
          id: "google-user-id-unverified",
          email,
          emailVerified: false,
          name: "Unverified Google User",
          image: "https://example.com/avatar-unverified.png",
        },
        account: {
          providerId: "google",
          accountId: "google-user-id-unverified",
          accessToken: "google-access-token-unverified",
          refreshToken: "google-refresh-token-unverified",
          idToken: "google-id-token-unverified",
          accessTokenExpiresAt: new Date("2026-03-31T03:00:00.000Z"),
          refreshTokenExpiresAt: new Date("2026-04-01T03:00:00.000Z"),
          scope: "openid email profile",
        },
        callbackURL: "http://localhost:5173/auth/login/callback?redirectTo=%2F",
      });

      expect(result.error).not.toBeNull();
      expect(result.data).toBeNull();

      const users = await fixture.db.query.users.findMany({
        columns: {
          id: true,
          email: true,
        },
        where: (users, { eq }) => eq(users.email, email),
      });
      expect(users).toHaveLength(1);
      expect(users[0]?.id).toBe(existingUser.id);

      const linkedGoogleAccount = await fixture.db.query.accounts.findFirst({
        columns: {
          userId: true,
          providerId: true,
          accountId: true,
        },
        where: (accounts, { and, eq }) =>
          and(
            eq(accounts.providerId, "google"),
            eq(accounts.accountId, "google-user-id-unverified"),
          ),
      });
      expect(linkedGoogleAccount).toBeUndefined();
    } finally {
      await workflowBackend.stop();
    }
  });
});
