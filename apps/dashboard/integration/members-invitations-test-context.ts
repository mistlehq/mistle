/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * Vitest fixture extension file intentionally uses `vitestIt.extend(...)` and
 * object-destructuring fixture signatures.
 */

import { randomUUID } from "node:crypto";

import { startIntegrationEnvironment } from "@mistle/test-environments";
import { it as vitestIt } from "vitest";

type DashboardIntegrationEnvironment = Awaited<ReturnType<typeof startIntegrationEnvironment>>;

export type AuthenticatedSession = {
  cookie: string;
  organizationId: string;
  userId: string;
};

export type DashboardMembersInvitationsFixture = {
  db: DashboardIntegrationEnvironment["apiRuntime"]["db"];
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authSession: (input?: { email?: string }) => Promise<AuthenticatedSession>;
};

const AUTH_OTP_LENGTH = 6;

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

function generateIntegrationAuthEmail(): string {
  return `integration-auth-${randomUUID()}@example.com`;
}

export const it = vitestIt.extend<{ fixture: DashboardMembersInvitationsFixture }>({
  fixture: [
    async ({}, use) => {
      const environment = await startIntegrationEnvironment({
        capabilities: ["members-invite-email"],
      });

      try {
        const mailpitService = environment.mailpitService;
        if (mailpitService === null) {
          throw new Error(
            "Expected mailpit service to be started for members-invite-email capability.",
          );
        }

        await use({
          db: environment.apiRuntime.db,
          request: environment.request,
          authSession: async (input) => {
            const email = input?.email ?? generateIntegrationAuthEmail();

            const sendResponse = await environment.request(
              "/v1/auth/email-otp/send-verification-otp",
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  email,
                  type: "sign-in",
                }),
              },
            );
            if (sendResponse.status !== 200) {
              throw new Error(
                `Expected OTP send response status 200, got ${String(sendResponse.status)}.`,
              );
            }

            const listItem = await mailpitService.waitForMessage({
              timeoutMs: 15_000,
              description: `OTP email for ${email}`,
              matcher: ({ message }) =>
                message.Subject === "Your sign-in code" &&
                message.To.some((address) => address.Address === email),
            });
            const message = await mailpitService.getMessageSummary(listItem.ID);
            const otp = extractOTPCode(message.Text);
            if (otp === undefined) {
              throw new Error("OTP was not found in Mailpit message text.");
            }

            const signInResponse = await environment.request("/v1/auth/sign-in/email-otp", {
              method: "POST",
              headers: {
                "content-type": "application/json",
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

            const user = await environment.apiRuntime.db.query.users.findFirst({
              columns: {
                id: true,
              },
              where: (users, { eq }) => eq(users.email, email),
            });
            if (user === undefined) {
              throw new Error("Expected user to be created after OTP sign-in.");
            }

            const session = await environment.apiRuntime.db.query.sessions.findFirst({
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
              const createOrganizationResponse = await environment.request(
                "/v1/auth/organization/create",
                {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    cookie: requestCookie,
                  },
                  body: JSON.stringify({
                    name: "Integration Organization",
                    slug: `integration-${randomUUID()}`,
                  }),
                },
              );
              if (createOrganizationResponse.status !== 200) {
                throw new Error(
                  `Expected organization create response status 200, got ${String(createOrganizationResponse.status)}.`,
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
        await environment.stop();
      }
    },
    {
      scope: "file",
    },
  ],
});
