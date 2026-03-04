/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * Vitest fixture extension file intentionally uses `vitestIt.extend(...)` and
 * object-destructuring fixture signatures.
 */

import { randomUUID } from "node:crypto";

import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { createMailpitInbox } from "@mistle/test-harness";
import { Pool } from "pg";
import { it as vitestIt } from "vitest";

import {
  createControlPlaneApiClient,
  type ControlPlaneApiClient,
} from "./control-plane-api-client.js";

export type AuthenticatedSession = {
  cookie: string;
  organizationId: string;
  userId: string;
};

export type DashboardMembersInvitationsFixture = {
  controlPlaneApiClient: ControlPlaneApiClient;
  db: ControlPlaneDatabase;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authSession: (input?: { email?: string }) => Promise<AuthenticatedSession>;
};

const AUTH_OTP_LENGTH = 6;
const AUTH_ORIGIN = "http://localhost:5100";

function extractOTPCode(text: string): string | undefined {
  const pattern = new RegExp(`\\b(\\d{${String(AUTH_OTP_LENGTH)}})\\b`);
  const match = text.match(pattern);

  return match?.[1];
}

function extractRequestCookie(setCookieHeader: string): string {
  const [cookiePair] = setCookieHeader.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected sign-in response to include a usable cookie value.");
  }

  return cookiePair;
}

function readOrganizationIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const id = Reflect.get(payload, "id");
  return typeof id === "string" && id.length > 0 ? id : null;
}

function generateAuthEmail(): string {
  return `system-auth-${randomUUID()}@example.com`;
}

function createRequestFn(baseUrl: string): (path: string, init?: RequestInit) => Promise<Response> {
  return async (path, init) => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return fetch(`${baseUrl}${normalizedPath}`, init);
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required system test environment variable: ${name}`);
  }

  return value;
}

export const it = vitestIt.extend<{ fixture: DashboardMembersInvitationsFixture }>({
  fixture: [
    async ({}, use) => {
      const controlPlaneApiBaseUrl = requireEnv("MISTLE_SYSTEM_CONTROL_PLANE_API_BASE_URL");
      const controlPlaneApiClient = createControlPlaneApiClient(controlPlaneApiBaseUrl);
      const request = createRequestFn(controlPlaneApiBaseUrl);
      const databasePool = new Pool({
        connectionString: requireEnv("MISTLE_SYSTEM_CONTROL_PLANE_DB_URL"),
      });
      const db = createControlPlaneDatabase(databasePool);
      const mailpitInbox = createMailpitInbox({
        httpBaseUrl: requireEnv("MISTLE_SYSTEM_MAILPIT_HTTP_BASE_URL"),
      });

      try {
        await use({
          controlPlaneApiClient,
          db,
          request,
          authSession: async (input) => {
            const email = input?.email ?? generateAuthEmail();

            const sendResponse = await request("/v1/auth/email-otp/send-verification-otp", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin: AUTH_ORIGIN,
              },
              body: JSON.stringify({
                email,
                type: "sign-in",
              }),
            });
            if (sendResponse.status !== 200) {
              throw new Error(
                `Expected OTP send response status 200, got ${String(sendResponse.status)}.`,
              );
            }

            const listItem = await mailpitInbox.waitForMessage({
              timeoutMs: 15_000,
              description: `OTP email for ${email}`,
              matcher: ({ message }) =>
                message.Subject === "Your sign-in code" &&
                message.To.some((address) => address.Address === email),
            });
            const message = await mailpitInbox.getMessageSummary(listItem.ID);
            const otp = extractOTPCode(message.Text);
            if (otp === undefined) {
              throw new Error("OTP was not found in Mailpit message text.");
            }

            const signInResponse = await request("/v1/auth/sign-in/email-otp", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin: AUTH_ORIGIN,
              },
              body: JSON.stringify({
                email,
                otp,
              }),
            });
            if (signInResponse.status !== 200) {
              throw new Error(
                `Expected OTP sign-in response status 200, got ${String(signInResponse.status)}.`,
              );
            }

            const setCookie = signInResponse.headers.get("set-cookie");
            if (typeof setCookie !== "string" || setCookie.length === 0) {
              throw new Error("Expected sign-in response to include set-cookie.");
            }

            const user = await db.query.users.findFirst({
              columns: {
                id: true,
              },
              where: (users, { eq }) => eq(users.email, email),
            });
            if (user === undefined) {
              throw new Error("Expected user to be created after OTP sign-in.");
            }

            const session = await db.query.sessions.findFirst({
              columns: {
                activeOrganizationId: true,
              },
              where: (sessions, { eq }) => eq(sessions.userId, user.id),
              orderBy: (sessions, { desc }) => [desc(sessions.createdAt)],
            });
            if (session === undefined) {
              throw new Error("Expected session to exist after OTP sign-in.");
            }

            const requestCookie = extractRequestCookie(setCookie);
            let activeOrganizationId =
              typeof session.activeOrganizationId === "string" &&
              session.activeOrganizationId.length > 0
                ? session.activeOrganizationId
                : null;

            if (activeOrganizationId === null) {
              const createOrganizationResponse = await request("/v1/auth/organization/create", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  cookie: requestCookie,
                  origin: AUTH_ORIGIN,
                },
                body: JSON.stringify({
                  name: "System Test Organization",
                  slug: `system-${randomUUID()}`,
                }),
              });
              if (createOrganizationResponse.status !== 200) {
                const errorBody = await createOrganizationResponse.text().catch(() => "");
                throw new Error(
                  `Expected organization create response status 200, got ${String(createOrganizationResponse.status)}. Response body: ${errorBody}`,
                );
              }

              const createOrganizationPayload: unknown = await createOrganizationResponse
                .json()
                .catch(() => null);
              activeOrganizationId = readOrganizationIdFromPayload(createOrganizationPayload);
              if (activeOrganizationId === null) {
                throw new Error(
                  "Expected organization create response to include organization id.",
                );
              }
            }

            return {
              cookie: requestCookie,
              organizationId: activeOrganizationId,
              userId: user.id,
            };
          },
        });
      } finally {
        await databasePool.end();
      }
    },
    {
      scope: "file",
    },
  ],
});
