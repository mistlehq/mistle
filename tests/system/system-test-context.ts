/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * Vitest fixture extension file intentionally uses `vitestIt.extend(...)` and
 * object-destructuring fixture signatures.
 */

import { randomUUID } from "node:crypto";

import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { createMailpitInbox, readTestContext } from "@mistle/test-harness";
import { Pool } from "pg";
import { it as vitestIt } from "vitest";
import { z } from "zod";

import {
  createControlPlaneApiClient,
  type ControlPlaneApiClient,
} from "./control-plane-api-client.js";

export type AuthenticatedSession = {
  cookie: string;
  organizationId: string;
  userId: string;
};

export type SystemTestFixture = {
  controlPlaneApiBaseUrl: string;
  controlPlaneWorkerBaseUrl: string;
  dataPlaneApiBaseUrl: string;
  dataPlaneWorkerBaseUrl: string;
  dataPlaneGatewayBaseUrl: string;
  tokenizerProxyBaseUrl: string;
  controlPlaneApiClient: ControlPlaneApiClient;
  db: ControlPlaneDatabase;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  sendSignInOtp: (input: { email: string }) => Promise<Response>;
  waitForSignInOtp: (input: { email: string }) => Promise<string>;
  signInWithOtp: (input: { email: string; otp: string }) => Promise<Response>;
  readRequestCookie: (signInResponse: Response) => string;
  createOrganization: (input: { cookie: string; name: string; slug: string }) => Promise<string>;
  authSession: (input?: { email?: string }) => Promise<AuthenticatedSession>;
};

const AUTH_OTP_LENGTH = 6;
const AUTH_ORIGIN = "http://localhost:5100";
const TestContextId = "system";

export const SystemTestContextSchema = z
  .object({
    controlPlaneApiBaseUrl: z.url(),
    controlPlaneWorkerBaseUrl: z.url(),
    dataPlaneApiBaseUrl: z.url(),
    dataPlaneWorkerBaseUrl: z.url(),
    dataPlaneGatewayBaseUrl: z.url(),
    tokenizerProxyBaseUrl: z.url(),
    mailpitHttpBaseUrl: z.url(),
    controlPlaneDatabaseUrl: z.string().min(1),
  })
  .strict();

export type SystemTestContext = z.infer<typeof SystemTestContextSchema>;

export async function readSystemTestContext(): Promise<SystemTestContext> {
  return readTestContext({
    id: TestContextId,
    schema: SystemTestContextSchema,
  });
}

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

export const it = vitestIt.extend<{ fixture: SystemTestFixture }>({
  fixture: [
    async ({}, use) => {
      const systemTestContext = await readSystemTestContext();
      const controlPlaneApiBaseUrl = systemTestContext.controlPlaneApiBaseUrl;
      const controlPlaneApiClient = createControlPlaneApiClient(controlPlaneApiBaseUrl);
      const request = createRequestFn(controlPlaneApiBaseUrl);
      const databasePool = new Pool({
        connectionString: systemTestContext.controlPlaneDatabaseUrl,
      });
      const db = createControlPlaneDatabase(databasePool);
      const mailpitInbox = createMailpitInbox({
        httpBaseUrl: systemTestContext.mailpitHttpBaseUrl,
      });
      const sendSignInOtp = async (input: { email: string }): Promise<Response> => {
        return request("/v1/auth/email-otp/send-verification-otp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: AUTH_ORIGIN,
          },
          body: JSON.stringify({
            email: input.email,
            type: "sign-in",
          }),
        });
      };
      const waitForSignInOtp = async (input: { email: string }): Promise<string> => {
        const listItem = await mailpitInbox.waitForMessage({
          timeoutMs: 15_000,
          description: `OTP email for ${input.email}`,
          matcher: ({ message }) =>
            message.Subject === "Your sign-in code" &&
            message.To.some((address) => address.Address === input.email),
        });
        const message = await mailpitInbox.getMessageSummary(listItem.ID);
        const otp = extractOTPCode(message.Text);
        if (otp === undefined) {
          throw new Error("OTP was not found in Mailpit message text.");
        }

        return otp;
      };
      const signInWithOtp = async (input: { email: string; otp: string }): Promise<Response> => {
        return request("/v1/auth/sign-in/email-otp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: AUTH_ORIGIN,
          },
          body: JSON.stringify({
            email: input.email,
            otp: input.otp,
          }),
        });
      };
      const readRequestCookie = (signInResponse: Response): string => {
        const setCookie = signInResponse.headers.get("set-cookie");
        if (typeof setCookie !== "string" || setCookie.length === 0) {
          throw new Error("Expected sign-in response to include set-cookie.");
        }

        return extractRequestCookie(setCookie);
      };
      const createOrganization = async (input: {
        cookie: string;
        name: string;
        slug: string;
      }): Promise<string> => {
        const createOrganizationResponse = await request("/v1/auth/organization/create", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: input.cookie,
            origin: AUTH_ORIGIN,
          },
          body: JSON.stringify({
            name: input.name,
            slug: input.slug,
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
        const organizationId = readOrganizationIdFromPayload(createOrganizationPayload);
        if (organizationId === null) {
          throw new Error("Expected organization create response to include organization id.");
        }

        return organizationId;
      };

      try {
        await use({
          controlPlaneApiBaseUrl: systemTestContext.controlPlaneApiBaseUrl,
          controlPlaneWorkerBaseUrl: systemTestContext.controlPlaneWorkerBaseUrl,
          dataPlaneApiBaseUrl: systemTestContext.dataPlaneApiBaseUrl,
          dataPlaneWorkerBaseUrl: systemTestContext.dataPlaneWorkerBaseUrl,
          dataPlaneGatewayBaseUrl: systemTestContext.dataPlaneGatewayBaseUrl,
          tokenizerProxyBaseUrl: systemTestContext.tokenizerProxyBaseUrl,
          controlPlaneApiClient,
          db,
          request,
          sendSignInOtp,
          waitForSignInOtp,
          signInWithOtp,
          readRequestCookie,
          createOrganization,
          authSession: async (input) => {
            const email = input?.email ?? generateAuthEmail();

            const sendResponse = await sendSignInOtp({
              email,
            });
            if (sendResponse.status !== 200) {
              throw new Error(
                `Expected OTP send response status 200, got ${String(sendResponse.status)}.`,
              );
            }

            const otp = await waitForSignInOtp({
              email,
            });
            const signInResponse = await signInWithOtp({
              email,
              otp,
            });
            if (signInResponse.status !== 200) {
              throw new Error(
                `Expected OTP sign-in response status 200, got ${String(signInResponse.status)}.`,
              );
            }

            const requestCookie = readRequestCookie(signInResponse);

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

            let activeOrganizationId =
              typeof session.activeOrganizationId === "string" &&
              session.activeOrganizationId.length > 0
                ? session.activeOrganizationId
                : null;

            if (activeOrganizationId === null) {
              activeOrganizationId = await createOrganization({
                cookie: requestCookie,
                name: "System Test Organization",
                slug: `system-${randomUUID()}`,
              });
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
